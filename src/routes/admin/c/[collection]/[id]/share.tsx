import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { grantItem, revokeItem, createShareLink, revokeShareLink, emailShareLink } from '@/services/access';
import { getCollectionOrThrow } from '@/services/collections';
import { getDocument } from '@/services/documents';
import { getSettings } from '@/services/settings';
import { getShareOverview } from '@/services/sharing';
import { createReviewLink, previewReviewModeFlip, setReviewMode, type ReviewMode } from '@/services/comments';
import { resolveBaseUrl } from '@/lib/base-url';
import { getEmailTransport } from '@/lib/email';
import { AppError } from '@/lib/errors';
import type { Action } from '@/access';
import { nowIso } from '@/lib/now';
import { rateLimit, SHARE_EMAIL_RATE_LIMIT } from '@/middleware/rate-limit';
import { ShareManager, ShareSummary, type ShareFlash, type ShareSurface } from '@/components/admin/share-drawer';

const factory = createFactory<{ Bindings: Env }>();

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** datetime-local (local time, no zone) → normalized ISO-8601, or undefined. */
function parseExpiry(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  return s ? new Date(s).toISOString() : undefined;
}

/**
 * POST /admin/c/:collection/:id/share — every Share-drawer action, dispatched
 * on `op`: create a read-only link (`link`) or a review link (`review_link`),
 * email one (`email_link`), revoke one (`revoke_link`), flip a review link's
 * mode (`review_mode_preview` → `review_mode`), grant/revoke item-level access
 * (`grant` / `revoke`), or just re-render (`refresh`).
 *
 * The drawer posts with Datastar, so the answer is a 200 fragment that morphs
 * `#share-manager` and `#share-summary` by id (DATASTAR_PATTERNS §d) — the
 * page never navigates, so unsaved edits in the editor behind the drawer
 * survive. Expected failures (a too-short password, a bad email) come back as
 * a flash in that same fragment rather than a toast. A plain form post still
 * gets a 303 back to the page the drawer is on (`?surface=viewer` = the framed
 * viewer, D60; otherwise the editor).
 */
export const onRequestPost = factory.createHandlers(requireAuth(), rateLimit('share-panel', SHARE_EMAIL_RATE_LIMIT), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const collection = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const op = String(body.op ?? '');
  const isDatastar = c.req.header('Datastar-Request') === 'true';
  // Which page the drawer is on (a closed set, never a free URL): the framed
  // viewer (D60) has no rail summary to refresh and returns to the view.
  const surface: ShareSurface = c.req.query('surface') === 'viewer' ? 'viewer' : 'editor';

  const settings = await getSettings(db);
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);

  const respond = async (flash?: ShareFlash) => {
    if (!isDatastar) return c.redirect(`/admin/c/${collection}/${id}${surface === 'viewer' ? '/view' : ''}`, 303);
    const def = await getCollectionOrThrow(db, collection);
    const doc = await getDocument(db, principal, collection, id, now);
    const overview = await getShareOverview(db, principal, def, id, { secret: c.env.SESSION_SECRET, baseUrl }, now);
    return c.html(
      <>
        <ShareManager
          slug={collection}
          id={id}
          def={def}
          doc={doc}
          overview={overview}
          settings={settings}
          flash={flash}
          surface={surface}
        />
        {surface === 'editor' ? <ShareSummary def={def} doc={doc} overview={overview} /> : null}
      </>,
    );
  };

  /** Hand a share link to the email transport; says honestly whether it sent. */
  const emailLink = async (url: string, email: string): Promise<string> => {
    const transport = getEmailTransport(c.env, settings);
    // Gating, URL-shape and email-shape checks all live in the service
    // (`authorize('share_link', …)`), so this can't become a spam relay.
    await emailShareLink(db, principal, { collection, documentId: id, url, email, baseUrl }, transport, settings.siteName, now);
    return transport.kind === 'resend'
      ? `Sent to ${email}.`
      : `Email isn't set up on this install, so nothing was sent to ${email}. Copy the link instead.`;
  };

  try {
    switch (op) {
      case 'refresh':
        return await respond();

      case 'revoke':
        await revokeItem(db, principal, String(body.grantId ?? ''), collection, id, now);
        return await respond({ tone: 'success', message: 'Access revoked.' });

      case 'revoke_link':
        await revokeShareLink(db, principal, collection, id, String(body.grantId ?? ''), now);
        return await respond({ tone: 'success', message: 'Link revoked. It no longer works.' });

      case 'link': {
        // Never trim a password — only an EMPTY string means "no password"; one
        // with meaningful leading/trailing spaces must round-trip unchanged, or
        // the human who set it can't unlock their own link.
        const password = String(body.password ?? '');
        const label = String(body.label ?? '').trim();
        const { token, hasPassword } = await createShareLink(
          db,
          principal,
          {
            collection,
            documentId: id,
            actions: ['read'],
            expiresAt: parseExpiry(body.expiresAt),
            password: password || undefined,
            label: label || undefined,
          },
          c.env.SESSION_SECRET,
          now,
        );
        // The token is also stored encrypted (D53), so the link stays copyable
        // from its row — only the PASSWORD is show-once.
        return await respond({
          tone: 'success',
          message: hasPassword ? 'Link created. Send the password separately; it isn’t shown again.' : 'Link created.',
          newUrl: `${baseUrl}/s/${token}`,
        });
      }

      // ── Review links (D55) ──────────────────────────────────────────────
      case 'review_link': {
        const name = String(body.reviewerName ?? '').trim();
        const email = String(body.reviewerEmail ?? '').trim();
        const password = String(body.password ?? '');
        const { token } = await createReviewLink(
          db,
          principal,
          {
            collection,
            documentId: id,
            mode: String(body.mode) === 'individual' ? 'individual' : 'group',
            reviewer: name ? { name, email: email || undefined } : undefined,
            expiresAt: parseExpiry(body.expiresAt),
            password: password || undefined,
          },
          c.env.SESSION_SECRET,
          now,
        );
        const newUrl = `${baseUrl}/s/${token}`;
        const sent = email ? ` ${await emailLink(newUrl, email)}` : '';
        return await respond({ tone: 'success', message: `Review link created.${sent}`, newUrl });
      }

      case 'email_link':
        return await respond({
          tone: 'success',
          message: await emailLink(String(body.url ?? ''), String(body.email ?? '').trim()),
        });

      // Flipping a mode re-scopes every PAST comment made through the link, so
      // it is confirmed first, in the link's own row, saying exactly what changes.
      case 'review_mode_preview': {
        const grantId = String(body.grantId ?? '');
        const flip = await previewReviewModeFlip(db, principal, collection, id, grantId, now);
        const people = `${flip.reviewers} reviewer${flip.reviewers === 1 ? '' : 's'}`;
        const things = `${flip.comments} comment${flip.comments === 1 ? '' : 's'}`;
        const warning =
          flip.to === 'group'
            ? `This will make ${things} from ${people} visible to everyone reviewing this document through a group link. Reviewers on this link will also start seeing other group reviewers’ comments.`
            : `This will hide ${things} from ${people} from other reviewers. Only you (and people with accounts) will still see them.`;
        return await respond({
          tone: 'success',
          message: 'Confirm the switch below.',
          confirmFlip: { grantId, to: flip.to, warning },
        });
      }

      case 'review_mode': {
        const mode: ReviewMode = String(body.mode) === 'individual' ? 'individual' : 'group';
        await setReviewMode(db, principal, collection, id, String(body.grantId ?? ''), mode, now);
        return await respond({ tone: 'success', message: `Switched to ${mode} review.` });
      }

      case 'grant': {
        // subject is encoded "principal:<id>" | "role:<slug>" | "team:<id>" so
        // one <select> covers all three.
        const [kind, ...rest] = String(body.subject ?? '').split(':');
        await grantItem(
          db,
          principal,
          {
            subjectKind: kind === 'role' ? 'role' : kind === 'team' ? 'team' : 'principal',
            subjectId: rest.join(':'),
            documentId: id,
            collection,
            actions: asArray(body.action as string | string[] | undefined) as Action[],
            expiresAt: parseExpiry(body.expiresAt),
          },
          now,
        );
        return await respond({ tone: 'success', message: 'Access granted.' });
      }

      default:
        return await respond({ tone: 'danger', message: 'That action isn’t recognised. Reload the page and try again.' });
    }
  } catch (err) {
    // Expected, explainable failures stay in the drawer; anything else (and
    // every non-Datastar post) goes to the global onError as before.
    if (isDatastar && err instanceof AppError && err.status < 500 && err.status !== 401 && err.status !== 403) {
      const detail = err.details?.map((d) => d.message).join(' ');
      return await respond({ tone: 'danger', message: detail || err.friendlyMessage });
    }
    throw err;
  }
});
