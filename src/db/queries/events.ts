/**
 * Events-outbox queries (D33). Event rows are POINTERS (type + collection +
 * resource id + actor + time — never payload) and are only ever written as
 * batch items INSIDE the mutation they describe: the other query modules
 * append `eventInsert(...)` to their atomic batches, so an event exists iff
 * its mutation committed. Reads are collection-filtered by the SERVICE
 * (per-collection read capability — src/services/events); prune is witness-free
 * daily maintenance (D31).
 */

import { and, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '@/db/client';
import { events } from '@/db/schema';

/** The event a service attaches to a mutation. `at` = the mutation's `now`. */
export interface EventInput {
  readonly type:
    | 'document.created'
    | 'document.updated'
    | 'document.deleted'
    | 'document.restored'
    | 'document.published'
    | 'document.unpublished'
    | 'document.visibility_changed'
    | 'media.created'
    | 'media.deleted'
    | 'collection.created'
    | 'collection.updated'
    | 'collection.deleted'
    | 'comment.created'
    | 'comment.resolved'
    | 'comment.reopened';
  readonly collection: string;
  readonly resource: string;
  readonly principalId: string;
  readonly at: string;
}

/** The batch item other query modules append to their atomic mutation batches. */
export function eventInsert(db: Database, e: EventInput): BatchItem<'sqlite'> {
  return db.insert(events).values({
    type: e.type,
    collection: e.collection,
    resource: e.resource,
    principalId: e.principalId,
    createdAt: e.at,
  });
}

export interface EventRow {
  readonly seq: number;
  readonly type: string;
  readonly collection: string;
  readonly resource: string;
  readonly principalId: string;
  readonly createdAt: string;
}

/** Events after `since`, oldest first, restricted to `readable` collections
 *  ('*' = no restriction; [] = nothing). The service composes `readable` from
 *  the caller's capabilities — this stays a dumb filter. */
export async function listEventRows(
  db: Database,
  opts: {
    readonly since: number;
    readonly collection?: string;
    readonly readable: '*' | readonly string[];
    readonly limit: number;
  },
): Promise<EventRow[]> {
  if (opts.readable !== '*' && opts.readable.length === 0) return [];
  const preds: SQL[] = [gt(events.seq, opts.since)];
  if (opts.collection) preds.push(eq(events.collection, opts.collection));
  if (opts.readable !== '*') preds.push(inArray(events.collection, [...opts.readable]));
  return db
    .select()
    .from(events)
    .where(and(...preds))
    .orderBy(events.seq)
    .limit(opts.limit);
}

/** Retention prune (D31): witness-free maintenance, returns rows dropped.
 *  Cursor GAPS after pruning are legal — pollers treat `since` as a horizon,
 *  not a contiguous log. */
export async function pruneEventRows(db: Database, cutoff: string): Promise<number> {
  const res = await db.delete(events).where(lt(events.createdAt, cutoff));
  return (res as { meta?: { changes?: number } }).meta?.changes ?? 0;
}

/** The current high-water mark (0 when empty) — lets a new poller start "from
 *  now" without paging history. */
export async function latestEventSeq(db: Database): Promise<number> {
  const rows = await db.select({ max: sql<number>`COALESCE(MAX(${events.seq}), 0)` }).from(events);
  return rows[0]?.max ?? 0;
}
