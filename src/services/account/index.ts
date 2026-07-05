/**
 * Account service — a human principal editing THEIR OWN profile and password.
 * Business logic + validation live here (routes stay thin, CODING_CONVENTIONS.md).
 *
 * Scope: this surface is for human/session principals only. Agents authenticate by
 * bearer token and have no password (ACCESS_CONTROL.md), so agent identity is
 * managed under /admin/access, never here. Every function operates STRICTLY on the
 * `principalId` the route resolves from the session (`getUser(c).id`) — never an id
 * taken from the request body — so a caller can only ever edit itself. No
 * authorize()/Grant is involved because there is no cross-principal access: the
 * identity IS the authorization.
 *
 * Limitation (documented, post-v1): the session lives in a stateless encrypted
 * cookie with no server-side registry, so changing the password here CANNOT revoke
 * sessions already minted on other devices — those cookies remain valid until they
 * expire. Server-side session invalidation is deferred.
 */

import type { Database } from '@/db/client';
import { getUserByEmail, updateUserEmail, updateUserPassword } from '@/db/queries/users';
import { updatePrincipalName } from '@/db/queries/principals';
import { hashPassword, verifyPassword } from '@/lib/password';
import { InputValidationError, ConflictError } from '@/lib/errors';

/** Minimum length for a new password. Deliberately modest (usability over a false
 *  sense of strength); scrypt hashing does the heavy lifting (SECURITY_STANDARDS §4). */
const MIN_PASSWORD_LENGTH = 8;
const NAME_MAX_LENGTH = 120;
const EMAIL_MAX_LENGTH = 254; // RFC 5321 practical address ceiling.
/** Boundary-grade email check — bounds + basic shape (validate at boundaries). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProfileInput {
  readonly displayName: string;
  readonly email: string;
}

export interface ProfileResult {
  readonly displayName: string;
  readonly email: string;
}

/**
 * Update the caller's display name + login email. Normalizes the email
 * (trim + lowercase, matching getUserByEmail) and rejects one already used by a
 * DIFFERENT principal. Returns the normalized values so the route can refresh the
 * session cookie (setSessionUser).
 */
export async function updateProfile(
  db: Database,
  principalId: string,
  input: ProfileInput,
): Promise<ProfileResult> {
  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();

  if (!displayName) {
    throw new InputValidationError([{ message: 'Display name is required.' }]);
  }
  if (displayName.length > NAME_MAX_LENGTH) {
    throw new InputValidationError([{ message: `Display name must be at most ${NAME_MAX_LENGTH} characters.` }]);
  }
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_RE.test(email)) {
    throw new InputValidationError([{ message: 'Enter a valid email address.' }]);
  }

  // Uniqueness: an email already owned by ANOTHER principal is a conflict. If it
  // resolves to this principal (unchanged, or re-typed identically), that is fine.
  const owner = await getUserByEmail(db, email);
  if (owner && owner.principalId !== principalId) {
    throw new ConflictError('That email address is already in use.');
  }

  await updatePrincipalName(db, principalId, displayName);
  await updateUserEmail(db, principalId, email);
  return { displayName, email };
}

export interface PasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/**
 * Change the caller's password. Verifies the CURRENT password first (against the
 * stored scrypt hash) and rejects a mismatch with a generic message — never
 * revealing whether the account or the password was wrong. Enforces a minimum
 * length on the new password, then re-hashes and stores it.
 *
 * `currentEmail` is the session user's email, used to load their credential row.
 * The loaded row MUST belong to `principalId` (defense in depth) — otherwise the
 * request is rejected generically.
 */
export async function changePassword(
  db: Database,
  principalId: string,
  currentEmail: string,
  input: PasswordInput,
): Promise<void> {
  const user = await getUserByEmail(db, currentEmail);
  // Generic rejection: don't distinguish "no such user" from "wrong password".
  if (!user || user.principalId !== principalId || !verifyPassword(input.currentPassword, user.passwordHash)) {
    throw new InputValidationError([{ message: 'Current password is incorrect.' }]);
  }

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new InputValidationError([
      { message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
    ]);
  }

  await updateUserPassword(db, principalId, hashPassword(input.newPassword));
}
