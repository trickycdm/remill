import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { restoreDocument } from '@/services/trash';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/trash/:id/restore — restore a trashed document under its original
 *  id (D29). 409 when the collection is gone or the id/unique value was retaken. */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const result = await restoreDocument(getDb(c.env.DB), await apiPrincipal(c, now), pathParam(c, 'id'), now);
  return apiJson(c, { data: result });
});
