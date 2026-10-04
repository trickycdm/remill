/**
 * POST /admin/account/passkeys/:id/rename — rename one of the signed-in human's
 * OWN passkeys (D58). The service scopes the write to the session principal, so
 * another person's passkey id is simply "not found".
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { requireAuth, getUser } from '@/lib/auth';
import { renamePasskey } from '@/services/passkeys';
import { pathParam } from '@/lib/http';
import { dsRedirect } from '@/lib/datastar-response';
import { renderSaveError } from '@/lib/save-error';
import { passkeyResultId } from '@/lib/passkey-http';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const form = await c.req.parseBody();
  const id = pathParam(c, 'id');
  try {
    await renamePasskey(getDb(c.env.DB), getUser(c).id, id, String(form.name ?? ''));
    return dsRedirect(c, '/admin/account');
  } catch (err) {
    return renderSaveError(c, err, passkeyResultId(id, 'rename'));
  }
});
