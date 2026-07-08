import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, listQuery, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listDocuments, createDocument } from '@/services/documents';
import { searchSite } from '@/services/search';
import { snippetToText } from '@/lib/fts';
import { BadRequestError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection — list documents (filter/sort/paginate, permission-
 *  filtered), or full-text search the collection when `?q=` is present (D28 —
 *  relevance-ranked, so `q` cannot combine with `sort`). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const slug = pathParam(c, 'collection');
  const q = listQuery(c);
  const db = getDb(c.env.DB);
  const principal = await apiPrincipal(c, now);

  if (q.q) {
    if (q.sort) throw new BadRequestError('`q` results are relevance-ranked; `sort` cannot apply.');
    const result = await searchSite(
      db,
      principal,
      { q: q.q, collection: slug, limit: q.pageSize, offset: (q.page - 1) * q.pageSize },
      now,
    );
    return apiJson(c, {
      data: result.hits.map((h) => ({ ...h, snippet: snippetToText(h.snippet) })),
      page: q.page,
      pageSize: result.limit,
      hasMore: result.hasMore,
    });
  }

  const result = await listDocuments(
    db,
    principal,
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
