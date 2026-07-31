import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { grantItem, revokeItem, listItemGrants } from '@/services/access';
import type { Action } from '@/access';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/:id/grants — list a document's item grants (manage_access). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const grants = await listItemGrants(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    now,
  );
  return apiJson(c, { data: grants });
});

/**
 * POST /api/c/:collection/:id/grants — grant a principal or role scoped actions on
 * this document. Body: `{ subjectKind, subjectId, actions[], expiresAt? }`.
 */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const id = await grantItem(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    {
      subjectKind: body.subjectKind === 'role' ? 'role' : 'principal',
      subjectId: String(body.subjectId ?? ''),
      documentId: pathParam(c, 'id'),
      collection: pathParam(c, 'collection'),
      actions: Array.isArray(body.actions) ? (body.actions.map(String) as Action[]) : [],
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
    },
    now,
  );
  return apiJson(c, { data: { id } }, 201);
});

/** DELETE /api/c/:collection/:id/grants — revoke a grant (`{ grantId }`). */
export const onRequestDelete = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = (await jsonBody(c).catch(() => ({}))) as Record<string, unknown>;
  await revokeItem(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    String(body.grantId ?? ''),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    now,
  );
  return apiJson(c, { data: { ok: true } });
});
