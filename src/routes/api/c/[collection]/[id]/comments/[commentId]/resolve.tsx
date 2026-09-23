import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { setThreadResolved } from '@/services/comments';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/c/:collection/:id/comments/:commentId/resolve — resolve a thread
 *  (stamped with the current revision). Body `{ resolved: false }` reopens it. */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = await jsonBody(c);
  const root = await setThreadResolved(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    pathParam(c, 'commentId'),
    body.resolved !== false,
    now,
  );
  return apiJson(c, { data: root });
});
