import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { setVisibility } from '@/services/documents';
import { getCollectionOrThrow, enablePublicPages } from '@/services/collections';
import type { Visibility } from '@/db/queries/documents';
import { InputValidationError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/visibility — set public/unlisted/private
 *  (D50, native form → 303). On a collection without public pages, a
 *  non-private value enables them safely (D57). A missing/malformed value is REJECTED — never
 *  defaulted to 'public', which would silently make a private document
 *  public on a malformed POST. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const body = await c.req.parseBody();
  if (typeof body.visibility !== 'string' || body.visibility.length === 0) {
    throw new InputValidationError([
      { path: 'visibility', message: 'Provide "public", "unlisted" or "private".' },
    ]);
  }
  const visibility = body.visibility as Visibility;
  const db = getDb(c.env.DB);
  const def = await getCollectionOrThrow(db, slug);
  // D57: Public/Unlisted on a collection without public pages means "Enable
  // public pages & apply" — the collection flips and every OTHER document
  // goes private in one batch. Private there is already the effective state.
  if (!def.access?.publicRead && visibility !== 'private') {
    await enablePublicPages(db, requirePrincipal(c), slug, { id, visibility }, nowIso());
  } else {
    await setVisibility(db, requirePrincipal(c), slug, id, visibility, nowIso());
  }
  return c.redirect(`/admin/c/${slug}/${id}`, 303);
});
