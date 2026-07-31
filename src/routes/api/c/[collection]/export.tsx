import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal } from '@/lib/api';
import { getDb } from '@/db/client';
import { exportCollection } from '@/services/transfer';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/export — the collection as NDJSON (D37): header line
 *  (full definition) then one document per line. Read-authorized and
 *  read-FILTERED: you export exactly what you can read. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const principal = await apiPrincipal(c, now);
  const slug = pathParam(c, 'collection');
  const { ndjson } = await exportCollection(getDb(c.env.DB), principal, slug, now);
  return c.body(ndjson, 200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
});
