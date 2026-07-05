import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listRevisions } from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/:id/revisions — revision history (newest first). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const revs = await listRevisions(getDb(c.env.DB), await apiPrincipal(c, now), pathParam(c, 'collection'), pathParam(c, 'id'), now);
  return apiJson(c, { data: revs });
});
