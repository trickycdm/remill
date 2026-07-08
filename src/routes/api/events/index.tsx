import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { pollEvents } from '@/services/events';
import { BadRequestError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /api/events?since=<seq>&collection=<slug>&limit= — the poll-based change
 * feed (D33). Events are pointers (type/collection/resource/actor/time, no
 * payload) filtered to collections the caller can read; re-fetch content via
 * the ordinary read endpoints. Response `{data, nextSince}` — pass `nextSince`
 * back as `since`. Rows prune after 30 days: gaps are legal; a `since` older
 * than the horizon simply returns what remains.
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const principal = await apiPrincipal(c, now);
  const q = c.req.query();
  const since = q.since === undefined || q.since === '' ? 0 : Number(q.since);
  if (!Number.isInteger(since) || since < 0) {
    throw new BadRequestError("'since' must be a non-negative integer event seq.");
  }
  const limit = q.limit ? Number(q.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new BadRequestError("'limit' must be a positive integer.");
  }
  const result = await pollEvents(getDb(c.env.DB), principal, {
    since,
    collection: q.collection || undefined,
    limit,
  });
  return apiJson(c, result);
});
