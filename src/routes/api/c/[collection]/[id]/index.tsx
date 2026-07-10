import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { getDocument, updateDocument, deleteDocument } from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/:id — read one document. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const doc = await getDocument(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    now,
  );
  return apiJson(c, { data: doc });
});

/** PATCH /api/c/:collection/:id — update a document. */
export const onRequestPatch = factory.createHandlers(async (c) => {
  const now = nowIso();
  const doc = await updateDocument(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    await jsonBody(c),
    now,
  );
  return apiJson(c, { data: doc });
});

/** DELETE /api/c/:collection/:id — delete a document. */
export const onRequestDelete = factory.createHandlers(async (c) => {
  const now = nowIso();
  await deleteDocument(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    now,
  );
  return apiJson(c, { data: { deleted: true } });
});
