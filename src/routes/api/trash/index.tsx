import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listTrash } from '@/services/trash';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/trash — trashed documents across every collection the caller can
 *  `delete` (own/published conditions applied in-query; D29). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const limit = Number(c.req.query('limit')) || undefined;
  const offset = Number(c.req.query('offset')) || undefined;
  const result = await listTrash(getDb(c.env.DB), await apiPrincipal(c, now), { limit, offset }, now);
  return apiJson(c, { data: result.rows, limit: result.limit, offset: result.offset });
});
