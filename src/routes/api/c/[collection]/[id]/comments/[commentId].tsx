import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { deleteComment } from '@/services/comments';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** DELETE /api/c/:collection/:id/comments/:commentId — delete your own comment
 *  (or any, with `update` on the document). A root takes its replies with it. */
export const onRequestDelete = factory.createHandlers(async (c) => {
  const now = nowIso();
  await deleteComment(
    getDb(c.env.DB),
    { kind: 'principal', principal: await apiPrincipal(c, now) },
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    pathParam(c, 'commentId'),
    now,
  );
  return apiJson(c, { data: { deleted: true } });
});
