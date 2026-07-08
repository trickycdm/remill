import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { deleteForever } from '@/services/trash';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** DELETE /api/trash/:id — permanently delete a trash entry (D29). */
export const onRequestDelete = factory.createHandlers(async (c) => {
  const now = nowIso();
  await deleteForever(getDb(c.env.DB), await apiPrincipal(c, now), pathParam(c, 'id'), now);
  return apiJson(c, { data: { deleted: true } });
});
