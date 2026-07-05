/**
 * Auth helpers for Hono + hono-sessions. Session state lives in an encrypted
 * cookie (no external store). See steering/SECURITY_STANDARDS.md.
 *
 * Phase 1 provides authentication (is there a valid session?) and a coarse
 * role guard. Fine-grained authorization — the authorize() choke point over
 * principals, roles, and item grants — lands in Phase 2–3 (src/access/). Route
 * guards here never replace that; they gate on session presence and coarse role only.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Session } from 'hono-sessions';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';
import type { SessionUser, SystemRole } from '@/lib/auth-constants';

export type { SessionUser, SystemRole } from '@/lib/auth-constants';

// ---------------------------------------------------------------------------
// Session read/write helpers
// ---------------------------------------------------------------------------

/** Extract the authenticated user from the session cookie, or null. */
export function getSessionUser(c: Context): SessionUser | null {
  const session = c.get('session') as Session | undefined;
  if (!session) return null;

  const userId = session.get('userId') as string | null;
  if (!userId) return null;

  return {
    id: userId,
    email: (session.get('email') as string | null) ?? '',
    displayName: (session.get('displayName') as string | null) ?? '',
    role: (session.get('role') as SystemRole | null) ?? 'reader',
  };
}

/** Write authenticated user data into the session after a successful login. */
export function setSessionUser(c: Context, user: SessionUser): void {
  const session = c.get('session') as Session;
  session.set('userId', user.id);
  session.set('email', user.email);
  session.set('displayName', user.displayName);
  session.set('role', user.role);
}

/** Destroy the session (logout). */
export function clearSession(c: Context): void {
  const session = c.get('session') as Session;
  session.deleteSession();
}

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/** Require an authenticated session; set `c.get('user')`. Throws 401 otherwise. */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const user = getSessionUser(c);
    if (!user) {
      throw new UnauthorizedError('Authentication required');
    }
    c.set('user', user);
    await next();
  };
}

/**
 * Require an authenticated session whose coarse role is one of `roles`. This is a
 * nav/affordance guard only — the authoritative decision is authorize() in a
 * service (Phase 3). Throws 401 (no session) or 403 (role mismatch).
 */
export function requireRole(...roles: SystemRole[]): MiddlewareHandler {
  return async (c, next) => {
    const user = getSessionUser(c);
    if (!user) {
      throw new UnauthorizedError('Authentication required');
    }
    if (!roles.includes(user.role)) {
      throw new ForbiddenError(`Role '${user.role}' is not authorized for this resource`);
    }
    c.set('user', user);
    await next();
  };
}

/** Get the authenticated user from context (after requireAuth/requireRole). */
export function getUser(c: Context): SessionUser {
  const user = c.get('user') as SessionUser | undefined;
  if (!user) {
    throw new UnauthorizedError('No authenticated user in context');
  }
  return user;
}
