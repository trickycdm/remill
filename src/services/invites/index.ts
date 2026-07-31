/**
 * Invite consumption — setting an invited human's password from a single-use link.
 *
 * Un-gated by design: the invite TOKEN is the credential (identity-scoped, like
 * `/admin/account` operating on the session principal). There is no acting principal
 * to authorize; the token both identifies the target and proves the right to set its
 * password. Validity (exists / not consumed / not expired) is the gate, and the
 * token is single-use. See ACCESS_CONTROL.md (§ un-gated identity-scoped ops).
 */

import type { Database } from '@/db/client';
import * as inviteQ from '@/db/queries/invites';
import { updateUserPassword } from '@/db/queries/users';
import { hashToken } from '@/lib/token';
import { hashPassword } from '@/lib/password';
import { InputValidationError, UnauthorizedError } from '@/lib/errors';

const MIN_PASSWORD_LENGTH = 8;

/** Is this invite token currently valid? (Gates the set-password GET form.) */
export async function inviteIsValid(db: Database, token: string, now: string): Promise<boolean> {
  return (await inviteQ.findValidInviteByHash(db, await hashToken(token), now)) !== null;
}

/**
 * Set the invited human's password using a valid single-use token, then consume it.
 * Throws Unauthorized for an invalid/expired/used token (indistinguishable — no
 * enumeration oracle) and InputValidation for a weak password.
 */
export async function setPasswordWithInvite(db: Database, token: string, newPassword: string, now: string): Promise<void> {
  const rec = await inviteQ.findValidInviteByHash(db, await hashToken(token), now);
  if (!rec) throw new UnauthorizedError('This invite link is invalid or has expired.');
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new InputValidationError([{ path: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }]);
  }
  await updateUserPassword(db, rec.principalId, hashPassword(newPassword));
  await inviteQ.markInviteConsumed(db, rec.id, now);
}
