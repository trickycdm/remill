import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { replyToThread } from '@/services/comments';
import { nowIso } from '@/lib/now';
import { principalPanel, withFlash } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/review/comments/:commentId/replies (D55). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const principal = requirePrincipal(c);
  const collection = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const form = await c.req.parseBody();
  const flash = await withFlash(
    () =>
      replyToThread(
        db,
        { kind: 'principal', principal },
        collection,
        id,
        pathParam(c, 'commentId'),
        { body: String(form.body ?? '') },
        now,
      ),
    'Reply added.',
  );
  return c.html(await principalPanel(db, principal, collection, id, now, flash));
});
