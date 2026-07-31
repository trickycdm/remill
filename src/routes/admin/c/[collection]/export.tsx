import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { exportCollection } from '@/services/transfer';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /admin/c/:collection/export — the NDJSON export as a download (D37).
 *  Same read-filtered service as REST; the browser just gets an attachment. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const now = nowIso();
  const slug = pathParam(c, 'collection');
  const { ndjson } = await exportCollection(getDb(c.env.DB), requirePrincipal(c), slug, now);
  return c.body(ndjson, 200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Content-Disposition': `attachment; filename="${slug}-export.ndjson"`,
  });
});
