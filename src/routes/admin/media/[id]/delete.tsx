import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { deleteMedia } from '@/services/media';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/media/:id/delete — delete (blocked if referenced by a document). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  await deleteMedia(
    getDb(c.env.DB),
    c.env.MEDIA,
    requirePrincipal(c),
    pathParam(c, 'id'),
    nowIso(),
  );
  return c.redirect('/admin/media', 303);
});
