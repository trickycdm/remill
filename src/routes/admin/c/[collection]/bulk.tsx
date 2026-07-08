import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { bulkDocuments, BULK_OPS, type BulkOp } from '@/services/documents';
import { BadRequestError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

function asArray(v: string | File | (string | File)[] | undefined): string[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(String);
}

/** POST /admin/c/:collection/bulk — bulk publish/unpublish/trash (D39; native
 *  form from the selectable list). Per-item authorize/audit/events happen in
 *  the service loop; results come back as a `?bulk=ok:<n>,failed:<m>` flash. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'collection');
  const body = await c.req.parseBody({ all: true });
  const ids = asArray(body.ids as string | string[] | undefined);
  const op = String(body.op ?? '');
  if (!(BULK_OPS as readonly string[]).includes(op)) {
    throw new BadRequestError(`Unknown bulk op '${op}'.`);
  }
  if (ids.length === 0) return c.redirect(`/admin/c/${slug}?bulk=none`, 303);
  const { ok, failed } = await bulkDocuments(getDb(c.env.DB), requirePrincipal(c), slug, op as BulkOp, ids, nowIso());
  return c.redirect(`/admin/c/${slug}?bulk=ok:${ok},failed:${failed}`, 303);
});
