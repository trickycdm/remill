/**
 * POST /admin/account/password — change the signed-in human's password.
 *
 * Scoped strictly to the SESSION principal (`getUser(c).id`/`.email`) — never a
 * body id. The service verifies the CURRENT password before writing and enforces a
 * minimum length; here we additionally confirm the new/confirm fields match (a
 * presentation concern). Errors morph inline into `#security-result`.
 *
 * Limitation (post-v1): the stateless encrypted session cookie has no server-side
 * registry, so a password change cannot revoke sessions on OTHER devices — those
 * cookies stay valid until they expire (documented in services/account).
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { requireAuth, getUser } from '@/lib/auth';
import { changePassword } from '@/services/account';
import { InputValidationError } from '@/lib/errors';
import { dsRedirect } from '@/lib/datastar-response';
import { renderSaveError } from '@/lib/save-error';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const form = await c.req.parseBody();
  const currentPassword = String(form.currentPassword ?? '');
  const newPassword = String(form.newPassword ?? '');
  const confirmPassword = String(form.confirmPassword ?? '');

  try {
    if (newPassword !== confirmPassword) {
      throw new InputValidationError([{ message: 'New passwords do not match.' }]);
    }
    await changePassword(getDb(c.env.DB), user.id, user.email, { currentPassword, newPassword });
    // Re-render the (cleared) page; this device's session cookie stays valid.
    return dsRedirect(c, '/admin/account');
  } catch (err) {
    return renderSaveError(c, err, 'security-result');
  }
});
