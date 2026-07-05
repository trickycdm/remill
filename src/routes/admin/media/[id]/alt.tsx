import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { updateAlt } from '@/services/media';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/media/:id/alt — update alt text. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  await updateAlt(getDb(c.env.DB), requirePrincipal(c), pathParam(c, 'id'), String(body.alt ?? ''), nowIso());
  return c.redirect('/admin/media', 303);
});
