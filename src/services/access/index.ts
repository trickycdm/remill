/**
 * Access-management service — roles, assignments, and item grants, all gated by
 * `manage_access` (steering/ACCESS_CONTROL.md). `manage_access` is held by humans
 * by default, so agents cannot escalate themselves or each other.
 *
 * The action vocabulary and condition enum are CLOSED (plan §8): custom roles may
 * only compose existing actions/conditions. Attempting an unknown one is rejected.
 */

import type { Database } from '@/db/client';
import { authorize, ACTIONS, type Principal } from '@/access';
import * as roleQ from '@/db/queries/roles';
import * as grantQ from '@/db/queries/grants';
import * as principalQ from '@/db/queries/principals';
import * as inviteQ from '@/db/queries/invites';
import { getUserByEmail } from '@/db/queries/users';
import { recentAudit } from '@/db/queries/audit';
import { generateToken, hashToken } from '@/lib/token';
import { hashPassword } from '@/lib/password';
import type { PermissionSpec, RoleSpec } from '@/access/policy';
import { SYSTEM_ROLE_SLUGS } from '@/access/policy';
import type { Action, Condition } from '@/access/types';
import type { MachinePersona } from '@/lib/persona';
import { InputValidationError, NotFoundError, ForbiddenError, ConflictError } from '@/lib/errors';
import type { ErrorDetails } from '@/lib/errors';

const ROLE_SLUG_RE = /^[a-z][a-z0-9-]*$/;
const CONDITIONS: readonly Condition[] = ['own', 'published'];

// Human-credential policy (mirrors src/services/account/index.ts).
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // set-password links expire in 7 days

// manage_access decisions concern the whole install, not one collection.
const ROOT = { collection: '*' };

export const listRoles = roleQ.listRoles;

/**
 * Resolve a principal's effective role permissions. Exposed for capability
 * discovery (e.g. MCP tool visibility) so the MCP surface routes through a SERVICE
 * rather than importing the queries layer directly (COR-6 layering fix). Read-only,
 * un-gated: a principal may always learn its OWN capabilities.
 */
export const getPrincipalPermissions = roleQ.getPrincipalPermissions;

/**
 * Structurally refuse access-management mutations by agent principals (SEC-8).
 * `manage_access` is a human-held capability: an agent must never grant roles or
 * mint tokens (for itself or others), even if it were somehow assigned the
 * permission. Defense in depth on top of authorize() — fail fast, before any audit
 * or mutation. Throws a clean structured 403.
 */
function refuseAgentEscalation(principal: Principal): void {
  if (principal.kind === 'agent') {
    throw new ForbiddenError('Agents cannot perform access-management operations.', {
      action: 'manage_access',
    });
  }
}

/** Validate a custom role's permission specs against the closed vocabularies. */
function validatePermissions(perms: readonly PermissionSpec[]): PermissionSpec[] {
  const issues: ErrorDetails[] = [];
  perms.forEach((p, i) => {
    if (!ACTIONS.includes(p.action as Action)) {
      issues.push({ path: `permissions[${i}].action`, message: `Unknown action '${p.action}'.` });
    }
    if (p.condition && !CONDITIONS.includes(p.condition)) {
      issues.push({ path: `permissions[${i}].condition`, message: `Unknown condition '${p.condition}'.` });
    }
  });
  if (issues.length) throw new InputValidationError(issues, 'Invalid role permissions');
  return [...perms];
}

export async function createRole(
  db: Database,
  principal: Principal,
  spec: RoleSpec,
  now: string,
): Promise<void> {
  await authorize(db, principal, 'manage_access', ROOT, now);
  if (!ROLE_SLUG_RE.test(spec.slug)) {
    throw new InputValidationError([{ path: 'slug', message: 'Invalid role slug.' }]);
  }
  if (SYSTEM_ROLE_SLUGS.includes(spec.slug)) {
    throw new ConflictError(`'${spec.slug}' is a reserved system role.`);
  }
  if (await roleQ.getRole(db, spec.slug)) throw new ConflictError(`Role '${spec.slug}' already exists.`);
  validatePermissions(spec.permissions);
  await roleQ.insertRole(db, spec, false, now);
}

export async function updateRole(
  db: Database,
  principal: Principal,
  slug: string,
  name: string,
  description: string | undefined,
  perms: PermissionSpec[],
  now: string,
): Promise<void> {
  await authorize(db, principal, 'manage_access', ROOT, now);
  const existing = await roleQ.getRole(db, slug);
  if (!existing) throw new NotFoundError('Role');
  if (existing.system) throw new ForbiddenError(`System role '${slug}' cannot be modified.`);
  validatePermissions(perms);
  await roleQ.setRolePermissions(db, slug, name, description, perms);
}

export async function deleteRole(db: Database, principal: Principal, slug: string, now: string): Promise<void> {
  await authorize(db, principal, 'manage_access', ROOT, now);
  const existing = await roleQ.getRole(db, slug);
  if (!existing) throw new NotFoundError('Role');
  if (existing.system) throw new ForbiddenError(`System role '${slug}' cannot be deleted.`);
  await roleQ.deleteRole(db, slug);
}

export async function assignRole(
  db: Database,
  principal: Principal,
  targetPrincipalId: string,
  role: string,
  collection: string,
  now: string,
): Promise<void> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  if (!(await roleQ.getRole(db, role))) throw new NotFoundError('Role');
  await roleQ.assignRole(db, targetPrincipalId, role, collection);
}

export async function unassignRole(
  db: Database,
  principal: Principal,
  targetPrincipalId: string,
  role: string,
  collection: string,
  now: string,
): Promise<void> {
  await authorize(db, principal, 'manage_access', ROOT, now);
  await roleQ.unassignRole(db, targetPrincipalId, role, collection);
}

export async function grantItem(
  db: Database,
  principal: Principal,
  input: {
    subjectKind: 'principal' | 'role';
    subjectId: string;
    documentId: string;
    collection: string;
    actions: Action[];
    expiresAt?: string;
  },
  now: string,
): Promise<string> {
  await authorize(db, principal, 'manage_access', { collection: input.collection, documentId: input.documentId }, now);
  const bad = input.actions.filter((a) => !ACTIONS.includes(a));
  if (bad.length) throw new InputValidationError(bad.map((a) => ({ path: 'actions', message: `Unknown action '${a}'.` })));
  return grantQ.createItemGrant(
    db,
    {
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      documentId: input.documentId,
      actions: input.actions,
      grantedBy: principal.id,
      expiresAt: input.expiresAt ?? null,
    },
    now,
  );
}

export async function revokeItem(db: Database, principal: Principal, grantId: string, collection: string, documentId: string, now: string): Promise<void> {
  await authorize(db, principal, 'manage_access', { collection, documentId }, now);
  await grantQ.revokeItemGrant(db, grantId);
}

export async function listAudit(db: Database, principal: Principal, now: string, limit = 100) {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return recentAudit(db, limit);
}

// ---------------------------------------------------------------------------
// Principals + tokens
// ---------------------------------------------------------------------------

export async function listPrincipals(db: Database, principal: Principal, now: string) {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return principalQ.listPrincipals(db);
}

/**
 * Create a machine principal — a Service (a system pulling data) or an Agent (an
 * autonomous AI client). Both are `kind: 'agent'` for security; `subtype` is the
 * persona label only. Requires `manage_access` (human-held; agents are refused).
 */
export async function createAgent(
  db: Database,
  principal: Principal,
  name: string,
  now: string,
  subtype: MachinePersona = 'agent',
): Promise<string> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  if (!name.trim()) throw new InputValidationError([{ path: 'name', message: 'Name is required.' }]);
  if (subtype !== 'service' && subtype !== 'agent') {
    throw new InputValidationError([{ path: 'subtype', message: `Unknown machine type '${subtype}'.` }]);
  }
  return principalQ.createAgentPrincipal(db, name.trim(), now, subtype);
}

/**
 * Create a human principal (a Person). Two paths, chosen by whether a password is
 * supplied:
 *  - direct: an initial password is set now — the person can sign in immediately.
 *  - invite: no password — an unusable random hash is stored and a single-use,
 *    expiring invite token is returned; the person sets their own password via the
 *    set-password link. (Email delivery of that link is the route's concern and is
 *    stubbed for now — the link is also surfaced once to the admin.)
 *
 * Gated by `manage_access` (human-held; agents refused). The initial role defaults
 * to `reader` (least privilege); `assignRole` validates it exists.
 */
export async function createUser(
  db: Database,
  principal: Principal,
  input: { name: string; email: string; password?: string; role?: string },
  now: string,
): Promise<{ principalId: string; inviteToken?: string }> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const role = input.role?.trim() || 'reader';
  const issues: ErrorDetails[] = [];
  if (!name) issues.push({ path: 'name', message: 'Name is required.' });
  if (!EMAIL_RE.test(email)) issues.push({ path: 'email', message: 'A valid email is required.' });
  if (input.password !== undefined && input.password.length < MIN_PASSWORD_LENGTH) {
    issues.push({ path: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }
  if (issues.length) throw new InputValidationError(issues, 'Invalid user');

  if (await getUserByEmail(db, email)) throw new ConflictError(`A user with email '${email}' already exists.`);

  // With no password, store an unguessable, unusable hash so login is impossible
  // until the invitee sets one via the token (verifyPassword can never match it).
  const passwordHash = hashPassword(input.password ?? generateToken());
  const principalId = await principalQ.createUserPrincipal(db, { name, email, passwordHash }, now);
  await assignRole(db, principal, principalId, role, '*', now);

  if (input.password !== undefined) return { principalId };

  const token = generateToken();
  const expiresAt = new Date(new Date(now).getTime() + INVITE_TTL_MS).toISOString();
  await inviteQ.createInviteToken(db, { principalId, tokenHash: await hashToken(token), expiresAt, now });
  return { principalId, inviteToken: token };
}

export async function listTokens(db: Database, principal: Principal, now: string, targetPrincipalId?: string) {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return principalQ.listTokens(db, targetPrincipalId);
}

/**
 * Issue a bearer token for a principal. Returns the plaintext ONCE — it is never
 * stored, only its hash. `scope` is the optional narrowing mask (effective
 * permission = principal's permissions ∩ scope).
 */
export async function issueToken(
  db: Database,
  principal: Principal,
  input: { principalId: string; name: string; scope?: { collection: string; action: Action }[]; expiresAt?: string },
  now: string,
): Promise<{ id: string; token: string }> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  if (!input.name.trim()) throw new InputValidationError([{ path: 'name', message: 'Token name is required.' }]);
  const bad = (input.scope ?? []).filter((s) => !ACTIONS.includes(s.action));
  if (bad.length) throw new InputValidationError(bad.map((s) => ({ path: 'scope', message: `Unknown action '${s.action}'.` })));
  const token = generateToken();
  const id = await principalQ.insertToken(db, {
    principalId: input.principalId,
    name: input.name.trim(),
    tokenHash: await hashToken(token),
    scope: input.scope ?? null,
    expiresAt: input.expiresAt ?? null,
    now,
  });
  return { id, token };
}

export async function revokeToken(db: Database, principal: Principal, tokenId: string, now: string): Promise<void> {
  await authorize(db, principal, 'manage_access', ROOT, now);
  await principalQ.revokeToken(db, tokenId);
}
