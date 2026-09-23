import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { COMMENT_INTENTS, createThread, listThreads, parseAnchorInput, type CommentIntent } from '@/services/comments';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/:id/comments — the document's review threads (D55),
 *  roots with replies. `?status=open|resolved`, `?intent=<intent>` filter. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const status = c.req.query('status');
  const intent = c.req.query('intent');
  const threads = await listThreads(
    getDb(c.env.DB),
    { kind: 'principal', principal: await apiPrincipal(c, now) },
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    {
      status: status === 'open' || status === 'resolved' ? status : undefined,
      intent: (COMMENT_INTENTS as readonly string[]).includes(intent ?? '') ? (intent as CommentIntent) : undefined,
    },
    now,
  );
  return apiJson(c, { data: threads });
});

/** POST /api/c/:collection/:id/comments — start a thread.
 *  Body: `{ body, anchor?, intent?, visibility? }` (anchor: see AnchorInput). */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = await jsonBody(c);
  const thread = await createThread(
    getDb(c.env.DB),
    { kind: 'principal', principal: await apiPrincipal(c, now) },
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    {
      anchor: parseAnchorInput(body.anchor),
      body: typeof body.body === 'string' ? body.body : '',
      intent: typeof body.intent === 'string' ? body.intent : undefined,
      visibility: typeof body.visibility === 'string' ? body.visibility : undefined,
    },
    now,
  );
  return apiJson(c, { data: thread }, 201);
});
