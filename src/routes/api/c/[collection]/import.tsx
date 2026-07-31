import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson, assertBodyWithinLimit, MAX_IMPORT_BODY_BYTES } from '@/lib/api';
import { rateLimit, IMPORT_RATE_LIMIT } from '@/middleware/rate-limit';
import { getDb } from '@/db/client';
import { importCollection } from '@/services/transfer';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/c/:collection/import — NDJSON upsert-by-id (D37). Body = a prior
 *  export (10 MiB cap — split larger imports into files). `?dryRun=1`
 *  validates without writing. Response {created, updated, failed, errors:
 *  [{line, id?, error}]} — per-line errors, the run never aborts. */
export const onRequestPost = factory.createHandlers(
  rateLimit('import', IMPORT_RATE_LIMIT),
  async (c) => {
    assertBodyWithinLimit(c, MAX_IMPORT_BODY_BYTES);
    const now = nowIso();
    const principal = await apiPrincipal(c, now);
    const slug = pathParam(c, 'collection');
    const text = await c.req.text();
    const result = await importCollection(getDb(c.env.DB), principal, slug, text, now, {
      dryRun: c.req.query('dryRun') === '1',
    });
    return apiJson(c, result);
  },
);
