import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { setPublished } from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/publish — toggle publish (native form → 303). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const body = await c.req.parseBody();
  const publish = String(body.publish ?? '1') === '1';
  await setPublished(getDb(c.env.DB), requirePrincipal(c), slug, id, publish, nowIso());
  return c.redirect(`/admin/c/${slug}/${id}`, 303);
});
