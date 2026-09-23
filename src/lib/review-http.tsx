/**
 * HTTP plumbing shared by the review-overlay endpoints (D55) — the reviewer
 * side under `/s/:token/review/*` and the principal side under
 * `/admin/c/:collection/:id/review/*`. Keeps those route files one-liners:
 * resolve who is asking, run one comments-service call, answer with the whole
 * review panel (morphed by id — DATASTAR_PATTERNS §d).
 *
 * Expected failures (validation, a thread the viewer can't see) come back as a
 * panel with an inline error rather than a Datastar alert: the reader stays in
 * the panel with their draft context, and the response is a 200 Datastar will
 * apply. Anything unexpected still goes to the global `onError`.
 */

import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Env } from '@/types';
import type { Database } from '@/db/client';
import { getDb } from '@/db/client';
import type { Principal } from '@/access';
import { openShareLink } from '@/services/access';
import * as comments from '@/services/comments';
import type { ItemGrantRecord } from '@/db/queries/grants';
import { AppError, NotFoundError } from '@/lib/errors';
import { REVIEWER_COOKIE, signReviewer, verifyReviewer } from '@/lib/reviewer-cookie';
import { hashToken } from '@/lib/token';
import { consumeRateLimit, REVIEW_POST_LINK_RATE_LIMIT } from '@/middleware/rate-limit';
import { nowIso } from '@/lib/now';
import { pathParam } from '@/lib/http';
import { ReviewPanel, type ReviewPanelViewer } from '@/components/review/review-panel';

type Ctx = Context<{ Bindings: Env }>;
type Flash = { readonly tone: 'status' | 'error'; readonly message: string };

/** What a comment form posts (field names from ReviewPanel's Composer). */
export function commentInputFromForm(form: Record<string, unknown>): comments.NewCommentInput {
  const str = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '');
  const target = str('target');
  let anchor: comments.AnchorInput | undefined;
  if (target === 'selection' && str('anchor')) {
    try {
      anchor = comments.parseAnchorInput(JSON.parse(str('anchor')));
    } catch (e) {
      if (e instanceof SyntaxError) anchor = undefined;
      else throw e;
    }
  } else if (target.startsWith('block:')) {
    anchor = { kind: 'block', blockId: target.slice('block:'.length) };
  }
  return {
    anchor,
    body: str('body'),
    intent: str('intent') || undefined,
    visibility: str('visibility') || undefined,
  };
}

/** Run an action; an expected (AppError) failure becomes the panel's error
 *  flash instead of an alert. */
export async function withFlash(action: () => Promise<unknown>, success: string): Promise<Flash> {
  try {
    await action();
    return { tone: 'status', message: success };
  } catch (e) {
    if (e instanceof AppError && e.status < 500) return { tone: 'error', message: e.friendlyMessage };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Reviewer side — /s/:token/review/*
// ---------------------------------------------------------------------------

export interface ReviewerRequest {
  readonly db: Database;
  readonly now: string;
  readonly token: string;
  readonly base: string;
  readonly grant: ItemGrantRecord;
  readonly collection: string;
  /** Null until an open-link reviewer has named themselves. */
  readonly viewer: Extract<comments.CommentViewer, { kind: 'reviewer' }> | null;
}

/** Resolve a review request: the link must be OPEN (password already unlocked)
 *  and a review link; anything else is the same 404 as an unknown token. */
export async function reviewerRequest(c: Ctx): Promise<ReviewerRequest> {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const token = pathParam(c, 'token');
  c.header('X-Robots-Tag', 'noindex');
  c.header('Cache-Control', 'private, no-store');
  const opened = await openShareLink(db, token, getCookie(c, 'rm_unlock'), c.env.SESSION_SECRET, now);
  if (!opened || opened.state !== 'open' || !comments.isReviewLink(opened.grant)) throw new NotFoundError('Review link');
  const grant = opened.grant;
  const cookieId = await verifyReviewer(c.env.SESSION_SECRET, grant.id, getCookie(c, REVIEWER_COOKIE));
  const who = await comments.reviewerForLink(db, grant, cookieId);
  return {
    db,
    now,
    token,
    base: `/s/${token}/review`,
    grant,
    collection: await comments.reviewLinkCollection(db, grant),
    viewer: who.state === 'ready' ? who.viewer : null,
  };
}

/** The per-link write budget (the per-IP one is route middleware). */
export async function consumeReviewPost(c: Ctx, token: string): Promise<void> {
  await consumeRateLimit(c.env.RATE_LIMIT, 'review-post-link', REVIEW_POST_LINK_RATE_LIMIT, await hashToken(token));
}

/** Remember an open-link reviewer's identity on this link only. */
export async function setReviewerCookie(c: Ctx, req: ReviewerRequest, reviewerId: string): Promise<void> {
  setCookie(c, REVIEWER_COOKIE, await signReviewer(c.env.SESSION_SECRET, req.grant.id, reviewerId), {
    path: `/s/${req.token}`,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 90,
  });
}

/** The panel for a reviewer (or the name form, until they have one). */
export async function reviewerPanel(
  req: ReviewerRequest,
  viewer: ReviewerRequest['viewer'] = req.viewer,
  flash?: Flash,
) {
  if (!viewer) {
    return <ReviewPanel base={req.base} viewer={{ kind: 'needs_name' }} threads={[]} blocks={[]} flash={flash} />;
  }
  const data = await comments.reviewPanelData(req.db, viewer, req.collection, req.grant.documentId, req.now);
  const panelViewer: ReviewPanelViewer = {
    kind: 'reviewer',
    reviewerId: viewer.reviewer.id,
    name: viewer.reviewer.name,
    mode: viewer.mode,
    done: viewer.reviewer.doneAt !== null,
  };
  return <ReviewPanel base={req.base} viewer={panelViewer} threads={data.threads} blocks={data.blocks} flash={flash} />;
}

/** A write needs a named reviewer; before that, answer with the name form. */
export function requireReviewer(req: ReviewerRequest): Extract<comments.CommentViewer, { kind: 'reviewer' }> {
  if (!req.viewer) throw new NotFoundError('Reviewer');
  return req.viewer;
}

// ---------------------------------------------------------------------------
// Principal side — /admin/c/:collection/:id/review/*
// ---------------------------------------------------------------------------

export async function principalPanel(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  now: string,
  flash?: Flash,
) {
  const viewer: comments.CommentViewer = { kind: 'principal', principal };
  const data = await comments.reviewPanelData(db, viewer, collection, documentId, now);
  return (
    <ReviewPanel
      base={`/admin/c/${collection}/${documentId}/review`}
      viewer={{ kind: 'principal', principalId: principal.id, canModerate: data.canModerate }}
      threads={data.threads}
      blocks={data.blocks}
      flash={flash}
    />
  );
}
