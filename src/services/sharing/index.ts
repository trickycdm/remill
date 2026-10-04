/**
 * Sharing overview — everything the editor's Share drawer shows for one
 * document, loaded behind the same gates each underlying list enforces. Pure
 * composition of the access + comments services: it adds no rule of its own,
 * it only decides (via non-throwing, non-auditing `canAuthorize` probes) which
 * of the gated lists this principal can be shown at all.
 *
 *  - links / review links need `share_link` on the document (editors included);
 *  - people & roles needs install-wide `manage_access`, matching what
 *    `listPrincipals` / `listRoles` require.
 *
 * Used by the edit page and by the share handler's in-place re-render, so both
 * always agree on what a principal sees.
 */

import type { Database } from '@/db/client';
import type { Principal } from '@/access';
import { canAuthorize } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import {
  getPrincipalPermissions,
  listItemGrants,
  listPrincipals,
  listRoles,
  listShareLinks,
  listTeams,
  createShareLink,
  type ShareLinkListItem,
} from '@/services/access';
import {
  hasAnnotatableFields,
  listReviewLinks,
  createReviewLink,
  type ReviewLinkListItem,
  type ReviewMode,
} from '@/services/comments';
import { getCollectionOrThrow } from '@/services/collections';
import { InputValidationError } from '@/lib/errors';

export interface SharePeople {
  readonly grants: Awaited<ReturnType<typeof listItemGrants>>;
  readonly principals: Awaited<ReturnType<typeof listPrincipals>>;
  readonly roles: Awaited<ReturnType<typeof listRoles>>;
  readonly teams: Awaited<ReturnType<typeof listTeams>>;
}

export interface ShareOverview {
  /** Read-only links; null when the principal lacks `share_link`. */
  readonly links: ShareLinkListItem[] | null;
  /** Review links (D55); null when the collection has nothing to annotate or
   *  the principal lacks `share_link`. */
  readonly reviewLinks: ReviewLinkListItem[] | null;
  /** Item grants + the subjects they can go to; null without `manage_access`. */
  readonly people: SharePeople | null;
}

/** Whether a review LINK is worth offering: the collection has something to
 *  annotate AND its page renders the review panel. A raw (D27) page is the
 *  author's own document with no panel in it, so a "can comment" link there
 *  would be a read-only link with a misleading name. (A framed page has one:
 *  the panel sits in the viewer shell beside the frame, D60.) */
export function hasReviewSurface(def: CollectionDefinition): boolean {
  return hasAnnotatableFields(def) && def.renderMode !== 'raw';
}

/** How long a link minted over the API or MCP may live. An expiry is REQUIRED
 *  there and clamped to this (D26); the admin drawer may mint open-ended links. */
export const API_SHARE_LINK_MAX_TTL_DAYS = 30;

export interface ApiShareLinkInput {
  readonly collection: string;
  readonly documentId: string;
  /** The raw request values — validated here, once, for REST and MCP alike. */
  readonly expiresAt?: unknown;
  readonly password?: unknown;
  readonly label?: unknown;
  /** Present ⇒ a REVIEW link (read + comment, D61). */
  readonly review?: unknown;
}

export interface ApiShareLink {
  readonly grantId: string;
  readonly token: string;
  readonly expiresAt: string | null;
  readonly hasPassword: boolean;
  readonly label: string | null;
  /** Null for a read-only link. */
  readonly review: { readonly mode: ReviewMode; readonly reviewer: string | null } | null;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Mint a share link for an API caller — the ONE implementation behind REST
 * `POST …/share-links` and MCP `share_link_<slug>`, so the two cannot drift
 * (API_AND_MCP_STANDARDS: parity). Read-only by default; `review: {mode,
 * reviewer?}` makes it a review link (D61) — the holder may also comment.
 * Either way the expiry is required and clamped to 30 days.
 *
 * Authorization is the services' own: `share_link` on the document
 * (`createShareLink`), plus `comment` for a review link (`createReviewLink`).
 */
export async function mintApiShareLink(
  db: Database,
  principal: Principal,
  input: ApiShareLinkInput,
  secret: string,
  now: string,
): Promise<ApiShareLink> {
  const common = {
    collection: input.collection,
    documentId: input.documentId,
    expiresAt: text(input.expiresAt),
    maxTtlDays: API_SHARE_LINK_MAX_TTL_DAYS,
    password: text(input.password),
    label: text(input.label),
  };
  if (input.review === undefined || input.review === null || input.review === false) {
    const link = await createShareLink(db, principal, { ...common, actions: ['read'] }, secret, now);
    return { ...link, review: null };
  }

  const review = (typeof input.review === 'object' ? input.review : {}) as Record<string, unknown>;
  const mode = review.mode === undefined ? 'group' : review.mode;
  if (mode !== 'group' && mode !== 'individual') {
    throw new InputValidationError([{ path: 'review.mode', message: "review.mode must be 'group' or 'individual'." }]);
  }
  const def = await getCollectionOrThrow(db, input.collection);
  if (!hasReviewSurface(def)) {
    throw new InputValidationError([
      { path: 'review', message: `${def.name} pages have no comment panel, so a review link would be read-only.` },
    ]);
  }
  const reviewer = text(review.reviewer);
  const link = await createReviewLink(
    db,
    principal,
    { ...common, mode, reviewer: reviewer ? { name: reviewer } : undefined },
    secret,
    now,
  );
  return {
    grantId: link.grantId,
    token: link.token,
    expiresAt: link.expiresAt,
    hasPassword: link.hasPassword,
    label: link.label,
    review: { mode, reviewer: link.reviewer?.name ?? null },
  };
}

export async function getShareOverview(
  db: Database,
  principal: Principal,
  def: CollectionDefinition,
  documentId: string,
  opts: { readonly secret: string; readonly baseUrl: string },
  now: string,
): Promise<ShareOverview> {
  const collection = def.slug;
  const perms = await getPrincipalPermissions(db, principal.id);
  const canManageAccess = perms.some((p) => p.action === 'manage_access' && p.collection === '*');
  // Through the real decision pipeline, so conditions (`own`) and item grants
  // count exactly as listShareLinks' own authorize() will.
  const canShareLink = await canAuthorize(db, principal, 'share_link', { collection, documentId }, now);

  const allLinks = canShareLink
    ? await listShareLinks(db, principal, collection, documentId, opts.secret, opts.baseUrl, now)
    : null;
  const reviewLinks =
    canShareLink && hasReviewSurface(def)
      ? await listReviewLinks(db, principal, collection, documentId, opts.secret, opts.baseUrl, now)
      : null;
  const people = canManageAccess
    ? {
        grants: await listItemGrants(db, principal, collection, documentId, now),
        principals: await listPrincipals(db, principal, now),
        roles: await listRoles(db),
        teams: await listTeams(db),
      }
    : null;

  return {
    links: allLinks ? allLinks.filter((l) => l.reviewMode === null) : null,
    reviewLinks,
    people,
  };
}

/** True when there is anything at all to show — otherwise the Share section
 *  is omitted from the editor entirely. */
export function canSeeSharing(overview: ShareOverview): boolean {
  return overview.links !== null || overview.people !== null;
}
