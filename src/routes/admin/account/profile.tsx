/**
 * POST /admin/account/profile — update the signed-in human's display name + email.
 *
 * Scoped strictly to the SESSION principal (`getUser(c).id`) — never a body id — so
 * a caller can only ever edit itself. On success we refresh the session cookie
 * (setSessionUser) so the top-bar name/email update immediately, then navigate back
 * via dsRedirect. Validation/conflict errors morph inline into `#profile-result`.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { requireAuth, getUser, setSessionUser } from '@/lib/auth';
import { updateProfile } from '@/services/account';
import { dsRedirect } from '@/lib/datastar-response';
import { renderSaveError } from '@/lib/save-error';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const form = await c.req.parseBody();
  const displayName = String(form.displayName ?? '');
  const email = String(form.email ?? '');

  try {
    const updated = await updateProfile(getDb(c.env.DB), user.id, { displayName, email });
    // Refresh the session so the shell reflects the new name/email on next render;
    // id + role are unchanged (role is never self-editable here).
    setSessionUser(c, { id: user.id, email: updated.email, displayName: updated.displayName, role: user.role });
    return dsRedirect(c, '/admin/account');
  } catch (err) {
    return renderSaveError(c, err, 'profile-result');
  }
});
