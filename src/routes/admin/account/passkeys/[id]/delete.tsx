/**
 * POST /admin/account/passkeys/:id/delete — remove one of the signed-in human's
 * OWN passkeys (D58). It stops working for sign-in immediately; the password is
 * unaffected.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { requireAuth, getUser } from '@/lib/auth';
import { removePasskey } from '@/services/passkeys';
import { pathParam } from '@/lib/http';
import { dsRedirect } from '@/lib/datastar-response';
import { renderSaveError } from '@/lib/save-error';
import { passkeyResultId } from '@/lib/passkey-http';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const id = pathParam(c, 'id');
  try {
    await removePasskey(getDb(c.env.DB), getUser(c).id, id);
    return dsRedirect(c, '/admin/account');
  } catch (err) {
    return renderSaveError(c, err, passkeyResultId(id, 'remove'));
  }
});
