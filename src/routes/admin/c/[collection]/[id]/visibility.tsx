import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { setVisibility } from '@/services/documents';
import type { Visibility } from '@/db/queries/documents';
import { InputValidationError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/c/:collection/:id/visibility — set public/unlisted/private
 *  (D50, native form → 303). A missing/malformed value is REJECTED — never
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
  await setVisibility(getDb(c.env.DB), requirePrincipal(c), slug, id, visibility, nowIso());
  return c.redirect(`/admin/c/${slug}/${id}`, 303);
});
