/**
 * Full-text search service (D28). One implementation behind all three surfaces:
 * the admin /admin/search page, REST `?q=`, and the MCP `search_<slug>` tools.
 *
 * ACL: the caller's compiled read predicate is applied IN-QUERY per collection
 * (D17) — a scope is only included after `authorize('read', …)` mints its Grant.
 * Collections the principal cannot read are skipped BEFORE authorize via the
 * same permission/tokenScope intersection `decide()` applies, so a search does
 * not spray deny rows into the audit log.
 */

import type { Database } from '@/db/client';
import {
  authorize,
  compileReadFilter,
  resolveAccess,
  scopeMatches,
  type Principal,
} from '@/access';
import type { ResolvedAccess } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { listCollections as listCollectionDefs } from '@/db/queries/collections';
import * as dq from '@/db/queries/documents';
import { searchDocuments as runSearch, type SearchScope, type SearchHit } from '@/db/queries/search';
import type { Grant } from '@/access/grant';
import { toFtsQuery } from '@/lib/fts';
import { buildSearchText } from '@/services/documents';
import { NotFoundError } from '@/lib/errors';

export type { SearchHit } from '@/db/queries/search';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Page size for the rebuild sweep — small enough to stay far from D1 limits. */
const REBUILD_PAGE = 200;

export interface SearchParams {
  readonly q: string;
  /** Restrict to one collection (the MCP `search_<slug>` tools); default: all
   *  readable, non-protected collections. */
  readonly collection?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface SearchResult {
  readonly hits: SearchHit[];
  readonly hasMore: boolean;
  readonly limit: number;
  readonly offset: number;
}

/** The pre-authorize readability check — mirrors decide()'s collection-level
 *  read rule (any applicable read permission, or publicRead), intersected with
 *  the token scope mask exactly as decide() does (TD-5). */
function canRead(principal: Principal, slug: string, resolved: ResolvedAccess): boolean {
  if (principal.tokenScope && !scopeMatches(principal.tokenScope, 'read', slug)) return false;
  if (resolved.publicRead) return true;
  return resolved.permissions.some(
    (p) => p.action === 'read' && (p.collection === '*' || p.collection === slug),
  );
}

export async function searchSite(
  db: Database,
  principal: Principal,
  params: SearchParams,
  now: string,
): Promise<SearchResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, params.offset ?? 0);
  const match = toFtsQuery(params.q);
  if (!match) return { hits: [], hasMore: false, limit, offset };

  const defs = await listCollectionDefs(db);
  // Protected system collections (e.g. the settings singleton) are config, not
  // content — they never surface in search results.
  const candidates = params.collection
    ? defs.filter((d) => d.slug === params.collection)
    : defs.filter((d) => !d.protected);
  if (params.collection && !candidates.length) {
    throw new NotFoundError(`Collection '${params.collection}'`);
  }

  const scopes: SearchScope[] = [];
  const grants: Grant[] = [];
  for (const def of candidates) {
    const resolved = await resolveAccess(db, principal.id, def.slug);
    if (!canRead(principal, def.slug, resolved)) continue;
    grants.push(await authorize(db, principal, 'read', { collection: def.slug }, now, resolved));
    scopes.push({
      collection: def.slug,
      accessFilter: await compileReadFilter(db, principal, def.slug, now, resolved),
    });
  }

  const { hits, hasMore } = await runSearch(db, { match, scopes, limit, offset }, grants);
  return { hits, hasMore, limit, offset };
}

/**
 * Recompute every document's FTS row from current data + definitions. The
 * post-deploy backfill for migration 0007, and the recovery path if the index
 * ever drifts. Admin surface only (the settings route gates on the admin role);
 * gated here on `manage_schema` — index maintenance is schema-engine territory.
 * Returns the number of documents reindexed.
 */
export async function rebuildSearchIndex(
  db: Database,
  principal: Principal,
  now: string,
): Promise<number> {
  await authorize(db, principal, 'manage_schema', { collection: '*' }, now);
  const defs = await listCollectionDefs(db);
  let total = 0;
  for (const def of defs as CollectionDefinition[]) {
    const grant = await authorize(db, principal, 'read', { collection: def.slug }, now);
    let cursor: dq.ListCursor | undefined;
    for (;;) {
      const { rows } = await dq.listDocuments(
        db,
        def.slug,
        { limit: REBUILD_PAGE, cursor },
        grant,
      );
      if (!rows.length) break;
      await dq.replaceFtsRows(
        db,
        rows.map((r) => ({ id: r.id, collection: def.slug, search: buildSearchText(def, r.data) })),
        grant,
      );
      total += rows.length;
      const last = rows[rows.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
      if (rows.length < REBUILD_PAGE) break;
    }
  }
  return total;
}
