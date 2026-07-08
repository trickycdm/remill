/**
 * Events feed service (D33) — "what changed since seq N", permission-filtered
 * PER COLLECTION: a caller sees events only for collections it can `read`
 * (role/wildcard via collectionsWithAction, plus live publicRead collections —
 * both narrowed by the token scope mask). Events are pointers; content is
 * re-fetched through the gated read surfaces, so this filter is about not
 * advertising activity in collections the caller has no window into. Rows are
 * pruned after EVENTS_RETENTION_DAYS — cursor gaps are legal; `since` is a
 * horizon, not a contiguous log.
 */

import type { Database } from '@/db/client';
import type { Principal } from '@/access';
import { scopeMatches } from '@/access';
import { collectionsWithAction } from '@/services/access';
import { listCollections } from '@/db/queries/collections';
import * as eq from '@/db/queries/events';
import { EVENTS_RETENTION_DAYS, DAY_MS } from '@/config/retention';
import { BadRequestError } from '@/lib/errors';

export type { EventRow } from '@/db/queries/events';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface PollResult {
  readonly data: eq.EventRow[];
  /** Pass back as `since` on the next poll. Echoes `since` when nothing new. */
  readonly nextSince: number;
}

/** The collections whose events this principal may see: role-granted `read`
 *  (scope-masked, via collectionsWithAction) UNION live publicRead collections
 *  (also scope-masked — collectionsWithAction deliberately leaves publicRead
 *  to the surface, see its NOTE). */
async function readableCollections(db: Database, principal: Principal): Promise<'*' | string[]> {
  const granted = await collectionsWithAction(db, principal, 'read');
  if (granted === '*') return '*';
  const defs = await listCollections(db);
  const publicSlugs = defs
    .filter((d) => d.access?.publicRead === true)
    .map((d) => d.slug)
    .filter((slug) => !principal.tokenScope || scopeMatches(principal.tokenScope, 'read', slug));
  return [...new Set([...granted, ...publicSlugs])];
}

export async function pollEvents(
  db: Database,
  principal: Principal,
  opts: { readonly since?: number; readonly collection?: string; readonly limit?: number },
): Promise<PollResult> {
  const since = opts.since ?? 0;
  if (!Number.isInteger(since) || since < 0) {
    throw new BadRequestError("'since' must be a non-negative integer event seq.");
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
  const readable = await readableCollections(db, principal);
  // Narrowing to a collection outside the readable set yields an EMPTY page,
  // not an error — indistinguishable from a quiet collection (no enumeration).
  const data = await eq.listEventRows(db, { since, collection: opts.collection, readable, limit });
  return { data, nextSince: data.length ? data[data.length - 1].seq : since };
}

/** Daily-cron retention prune (D31): witness-free maintenance. */
export async function pruneEvents(db: Database, now: string): Promise<number> {
  const cutoff = new Date(new Date(now).getTime() - EVENTS_RETENTION_DAYS * DAY_MS).toISOString();
  const pruned = await eq.pruneEventRows(db, cutoff);
  if (pruned > 0) console.log(`[cron] pruned ${pruned} expired event${pruned === 1 ? '' : 's'}`);
  return pruned;
}
