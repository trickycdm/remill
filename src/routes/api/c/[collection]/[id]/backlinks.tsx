import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { getBacklinks } from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/:id/backlinks — documents that reference this one
 *  (reverse edges of the graph, B3). Read-gated on the target; each source
 *  collection is filtered to what the caller may read. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const backlinks = await getBacklinks(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    now,
  );
  return apiJson(c, { data: backlinks });
});
