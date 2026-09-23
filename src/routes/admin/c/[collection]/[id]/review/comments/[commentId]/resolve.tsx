import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { setThreadResolved } from '@/services/comments';
import { nowIso } from '@/lib/now';
import { principalPanel, withFlash } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/review/comments/:commentId/resolve — resolve
 *  (`resolved=1`) or reopen (`resolved=0`) a thread (D55). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const principal = requirePrincipal(c);
  const collection = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const resolved = String((await c.req.parseBody()).resolved ?? '1') !== '0';
  const flash = await withFlash(
    () => setThreadResolved(db, principal, collection, id, pathParam(c, 'commentId'), resolved, now),
    resolved ? 'Thread resolved.' : 'Thread reopened.',
  );
  return c.html(await principalPanel(db, principal, collection, id, now, flash));
});
