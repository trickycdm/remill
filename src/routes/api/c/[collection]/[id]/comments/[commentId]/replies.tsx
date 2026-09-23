import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { replyToThread } from '@/services/comments';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/c/:collection/:id/comments/:commentId/replies — reply to a thread.
 *  Body: `{ body }`. */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = await jsonBody(c);
  const reply = await replyToThread(
    getDb(c.env.DB),
    { kind: 'principal', principal: await apiPrincipal(c, now) },
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    pathParam(c, 'commentId'),
    { body: typeof body.body === 'string' ? body.body : '' },
    now,
  );
  return apiJson(c, { data: reply }, 201);
});
