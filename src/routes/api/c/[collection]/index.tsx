import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, listQuery, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listDocuments, createDocument } from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection — list documents (filter/sort/paginate, permission-filtered). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const slug = pathParam(c, 'collection');
  const q = listQuery(c);
  const result = await listDocuments(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    slug,
    { page: q.page, pageSize: q.pageSize, status: q.status, sort: q.sort, filters: q.filters },
    now,
  );
  return apiJson(c, {
    data: result.rows,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  });
});

/** POST /api/c/:collection — create a document. */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const slug = pathParam(c, 'collection');
  const doc = await createDocument(getDb(c.env.DB), await apiPrincipal(c, now), slug, await jsonBody(c), now);
  return apiJson(c, { data: doc }, 201);
});
