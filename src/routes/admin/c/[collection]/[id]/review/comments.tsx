import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { createThread } from '@/services/comments';
import { nowIso } from '@/lib/now';
import { commentInputFromForm, principalPanel, withFlash } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/review/comments — a signed-in principal starts
 *  a thread from the preview overlay (D55). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const principal = requirePrincipal(c);
  const collection = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const input = commentInputFromForm(await c.req.parseBody());
  const flash = await withFlash(
    () => createThread(db, { kind: 'principal', principal }, collection, id, input, now),
    'Comment added.',
  );
  return c.html(await principalPanel(db, principal, collection, id, now, flash));
});
