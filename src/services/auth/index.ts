/**
 * Auth service — human login. Business logic lives here (routes stay thin).
 *
 * Role resolution: the coarse session role is the principal's strongest assigned
 * system role, resolved from `principal_roles` at login (Phase 3). It drives nav
 * affordances only — the authoritative decision is always authorize()
 * (steering/ACCESS_CONTROL.md).
 */

import type { Database } from '@/db/client';
import { getUserByEmail } from '@/db/queries/users';
import { getPrimaryRole } from '@/db/queries/roles';
import { verifyPassword } from '@/lib/password';
import type { SessionUser, SystemRole } from '@/lib/auth-constants';
import { getLogger } from '@/lib/logger';

const log = getLogger('auth-service');

/**
 * Verify credentials and return the SessionUser to store, or null on any failure
 * (unknown email, disabled principal, wrong password). Callers must not reveal
 * which of these it was.
 */
export async function authenticateUser(
  db: Database,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const user = await getUserByEmail(db, email);
  if (!user || user.disabled) {
    // Still run a hash to keep timing roughly uniform against user enumeration.
    verifyPassword(password, 'deadbeef:deadbeef');
    return null;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    log.warn({ principalId: user.principalId }, 'failed login');
    return null;
  }

  return {
    id: user.principalId,
    email: user.email,
    displayName: user.displayName,
    role: (await getPrimaryRole(db, user.principalId)) as SystemRole,
  };
}
