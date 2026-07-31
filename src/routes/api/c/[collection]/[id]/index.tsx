import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import {
  getDocument,
  renderDocumentText,
  updateDocument,
  deleteDocument,
} from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/:id — read one document. `?render=<name>` returns a
 *  role-tailored markdown brief instead (D47); `?budget=` caps its approximate
 *  tokens. The service validates both — the route stays dumb. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const render = c.req.query('render');
  if (render !== undefined) {
    const budgetRaw = c.req.query('budget');
    const budget = budgetRaw === undefined ? undefined : Number(budgetRaw);
    const md = await renderDocumentText(
      getDb(c.env.DB),
      await apiPrincipal(c, now),
      pathParam(c, 'collection'),
      pathParam(c, 'id'),
      { render, budget },
      now,
    );
    return c.body(md, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  }
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
