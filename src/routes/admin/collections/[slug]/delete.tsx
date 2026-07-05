import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { deleteCollection } from '@/services/collections';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/collections/:slug/delete — delete, then return to the list. The
 *  service blocks deletion of protected collections (ForbiddenError). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'slug');
  await deleteCollection(getDb(c.env.DB), requirePrincipal(c), slug, nowIso());
  return c.redirect('/admin/collections', 303);
});
