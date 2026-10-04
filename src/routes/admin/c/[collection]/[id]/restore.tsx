import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { restoreRevision } from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/restore — restore a revision as a new save.
 *  `return=view` (the framed viewer's Versions drawer, D60) lands back on the
 *  view; anything else on the editor — a closed choice, never a free URL. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const body = await c.req.parseBody();
  const revision = Number(body.revision);
  await restoreRevision(getDb(c.env.DB), requirePrincipal(c), slug, id, revision, nowIso());
  return c.redirect(`/admin/c/${slug}/${id}${body.return === 'view' ? '/view' : ''}`, 303);
});
