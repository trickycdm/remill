/**
 * Shared auth constants and types (safe for both server and client bundles — no
 * server-only imports here). The authoritative role/permission model lives in
 * steering/ACCESS_CONTROL.md and is implemented in src/access/ (Phase 3). This
 * file holds only the seeded system-role vocabulary and the session-user shape.
 */

/**
 * Seeded system roles. Roles are data (rows in `roles`), so custom roles can be
 * created at runtime — this union is just the built-in set every install starts
 * with. `anonymous` is the role of the unauthenticated principal.
 */
export type SystemRole = 'admin' | 'editor' | 'author' | 'reader' | 'anonymous';

export const SYSTEM_ROLES: readonly SystemRole[] = [
  'admin',
  'editor',
  'author',
  'reader',
  'anonymous',
] as const;

/**
 * The authenticated human as carried in the session cookie. `role` is the
 * principal's primary role, resolved from the DB at login and written to the
 * session — NEVER read from client input (steering/SECURITY_STANDARDS.md).
 * Fine-grained authorization is computed per-request by authorize() (Phase 3);
 * this coarse role drives admin-nav affordances only.
 */
export interface SessionUser {
  readonly id: string; // principal id (prn_…)
  readonly email: string;
  readonly displayName: string;
  readonly role: SystemRole;
}
