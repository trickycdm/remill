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
  parseExpectedRevision,
} from '@/services/documents';
import { renderReview } from '@/services/comments';
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
    // `review` (D55) is the comments brief — any collection with annotatable
    // fields, for principals who may comment.
    if (render === 'review') {
      const md = await renderReview(
        getDb(c.env.DB),
        await apiPrincipal(c, now),
        pathParam(c, 'collection'),
        pathParam(c, 'id'),
        { budget },
        now,
      );
      return c.body(md, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    }
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
  // The current revision doubles as the entity tag (D54): echo it in If-Match.
  c.header('ETag', `"${doc.revision}"`);
  return apiJson(c, { data: doc });
});

/** PATCH /api/c/:collection/:id — update a document. `If-Match: "<revision>"`
 *  makes the save conditional (D54): a stale revision is a 409 STALE_REVISION. */
export const onRequestPatch = factory.createHandlers(async (c) => {
  const now = nowIso();
  const doc = await updateDocument(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    await jsonBody(c),
    now,
    { expectedRevision: parseExpectedRevision(c.req.header('If-Match')) },
  );
  c.header('ETag', `"${doc.revision}"`);
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
