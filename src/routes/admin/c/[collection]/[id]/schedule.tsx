import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { scheduleDocument } from '@/services/documents';
import { datetimeLocalToIso } from '@/fields/datetime';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/schedule — set or cancel a scheduled publish
 *  (D32; native form → 303). `op=cancel` clears; otherwise `publish_at` arrives
 *  in the `datetime-local` widget shape and converts to ISO here (the service
 *  validates the result). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const body = await c.req.parseBody();
  const publishAt = body.op === 'cancel' ? null : datetimeLocalToIso(String(body.publish_at ?? ''));
  await scheduleDocument(getDb(c.env.DB), requirePrincipal(c), slug, id, publishAt, nowIso());
  return c.redirect(`/admin/c/${slug}/${id}`, 303);
});
