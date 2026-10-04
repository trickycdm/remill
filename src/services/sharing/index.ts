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
  type ShareLinkListItem,
} from '@/services/access';
import { hasAnnotatableFields, listReviewLinks, type ReviewLinkListItem } from '@/services/comments';

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
function hasReviewSurface(def: CollectionDefinition): boolean {
  return hasAnnotatableFields(def) && def.renderMode !== 'raw';
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
