/**
 * Access-management service — roles, assignments, and item grants, all gated by
 * `manage_access` (steering/ACCESS_CONTROL.md). `manage_access` is held by humans
 * by default, so agents cannot escalate themselves or each other.
 *
 * The action vocabulary and condition enum are CLOSED (plan §8): custom roles may
 * only compose existing actions/conditions. Attempting an unknown one is rejected.
 */

import type { Database } from '@/db/client';
import { authorize, ACTIONS, scopeMatches, type Principal } from '@/access';
import * as roleQ from '@/db/queries/roles';
import * as grantQ from '@/db/queries/grants';
import * as principalQ from '@/db/queries/principals';
import * as inviteQ from '@/db/queries/invites';
import * as teamQ from '@/db/queries/teams';
import { clientNameForPrincipal } from '@/db/queries/oauth';
import { getUserByEmail } from '@/db/queries/users';
import { recentAudit } from '@/db/queries/audit';
import * as auditQ from '@/db/queries/audit';
import { generateToken, generateShareToken, generateJoinToken, hashToken } from '@/lib/token';
import { hashPassword, verifyPassword } from '@/lib/password';
import { signUnlock, verifyUnlock } from '@/lib/share-unlock';
import { encryptToken, decryptToken } from '@/lib/share-token-crypto';
import type { EmailTransport } from '@/lib/email';
import { shareNotificationEmail } from '@/lib/email/templates';
import type { PermissionSpec, RoleSpec } from '@/access/policy';
import { SYSTEM_ROLE_SLUGS } from '@/access/policy';
import type { Action, Condition } from '@/access/types';
import { personaOf, type MachinePersona, type Persona } from '@/lib/persona';
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
 * The collections on which `principal` holds `action` via roles, intersected
 * with the token scope mask exactly as decide() narrows (TD-5): `'*'` for an
 * unmasked wildcard grant, else the explicit slug list. A capability PRE-CHECK
 * for cross-collection surfaces (trash listing; later the events feed) so they
 * can scope queries without spraying deny rows into the audit log — per-item
 * authorize() still gates every action taken. NOTE: deliberately does NOT add
 * `publicRead` collections for `read`; anonymous-readable surfaces resolve
 * that themselves (see services/search).
 */
export async function collectionsWithAction(
  db: Database,
  principal: Principal,
  action: Action,
): Promise<'*' | string[]> {
  const perms = await roleQ.getPrincipalPermissions(db, principal.id);
  return collectionsWithActionFrom(perms, principal, action);
}

/** The pure half of `collectionsWithAction` — for callers that already hold the
 *  principal's resolved permissions (TD-3: resolve once, derive many). */
export function collectionsWithActionFrom(
  perms: readonly roleQ.EffectivePermission[],
  principal: Principal,
  action: Action,
): '*' | string[] {
  const matching = perms.filter((p) => p.action === action);
  if (matching.some((p) => p.collection === '*')) {
    // A wildcard role grant is still narrowed by a scoped token (a mask never widens).
    if (!principal.tokenScope) return '*';
    const masked = principal.tokenScope.filter((s) => s.action === action).map((s) => s.collection);
    return masked.includes('*') ? '*' : [...new Set(masked)];
  }
  const scoped = matching
    .map((p) => p.collection)
    .filter((col) => !principal.tokenScope || scopeMatches(principal.tokenScope, action, col));
  return [...new Set(scoped)];
}

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
    subjectKind: 'principal' | 'role' | 'team';
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

/**
 * Create a SHARE LINK (C3): an item grant whose subject is the hashed link token
 * (`subjectKind: 'link'`) — the same additive grant machinery as principals and
 * roles, so expiry, revocation (the Share panel's revoke works unchanged), the
 * access matrix, and audit all come free. Returns the plaintext token (also
 * stored encrypted in `token_enc`, D53, so `listShareLinks` can re-display the
 * URL later — the lookup itself still matches only on the hash).
 */
const LABEL_MAX_LENGTH = 80;

export async function createShareLink(
  db: Database,
  principal: Principal,
  input: {
    collection: string;
    documentId: string;
    actions: Action[];
    expiresAt?: string;
    /** When set, `expiresAt` becomes REQUIRED and is clamped to this many days
     *  out from `now` — the one rule REST and MCP both enforce (steering
     *  API_AND_MCP_STANDARDS.md: "same rules as the MCP tool"; both pass 30).
     *  The admin Share panel passes none — humans may still mint open-ended
     *  links. */
    maxTtlDays?: number;
    /** Optional password (D51) — minimum 8 characters, hashed with scrypt.
     *  Never logged or returned; only `hasPassword` comes back. */
    password?: string;
    /** Optional human label shown in the Share panel, trimmed and capped. */
    label?: string;
    /** Makes the link a REVIEW link (D55) — only meaningful with `comment` in
     *  `actions`; the comments service's `createReviewLink` is the caller. */
    reviewMode?: grantQ.ReviewMode;
  },
  /** SESSION_SECRET — keys the AES-GCM encryption of the stored token (D53). */
  secret: string,
  now: string,
): Promise<{ grantId: string; token: string; hasPassword: boolean; label: string | null; expiresAt: string | null }> {
  // D26: gated by the dedicated `share_link` action, NOT manage_access — so the
  // capability is grantable to an agent (via a role or a one-document item
  // grant) without any access-management power. The agents-never-escalate rule
  // (SEC-8) still guards every identity/role/token mutation above; a share
  // link only ADDs anonymous read on one document, is audited, expirable, and
  // revocable from the Share panel/matrix like any grant.
  await authorize(db, principal, 'share_link', { collection: input.collection, documentId: input.documentId }, now);
  const bad = input.actions.filter((a) => !ACTIONS.includes(a));
  if (bad.length) throw new InputValidationError(bad.map((a) => ({ path: 'actions', message: `Unknown action '${a}'.` })));
  if (!input.actions.length) throw new InputValidationError([{ path: 'actions', message: 'Grant at least one action.' }]);

  if (input.password !== undefined && input.password.length < MIN_PASSWORD_LENGTH) {
    throw new InputValidationError([
      { path: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
    ]);
  }

  if (input.maxTtlDays !== undefined && !input.expiresAt) {
    throw new InputValidationError([{ path: 'expiresAt', message: 'expiresAt is required.' }]);
  }
  let expiresAt: string | null = null;
  if (input.expiresAt !== undefined) {
    const parsed = Date.parse(input.expiresAt);
    if (Number.isNaN(parsed)) {
      throw new InputValidationError([{ path: 'expiresAt', message: 'A valid ISO-8601 expiry is required.' }]);
    }
    let ms = parsed;
    if (input.maxTtlDays !== undefined) {
      const maxMs = new Date(now).getTime() + input.maxTtlDays * 24 * 60 * 60 * 1000;
      ms = Math.min(ms, maxMs);
    }
    expiresAt = new Date(ms).toISOString();
  }

  const passwordHash = input.password ? hashPassword(input.password) : null;
  const label = input.label?.trim().slice(0, LABEL_MAX_LENGTH) || null;

  const token = generateShareToken();
  const grantId = await grantQ.createItemGrant(
    db,
    {
      subjectKind: 'link',
      subjectId: await hashToken(token),
      documentId: input.documentId,
      actions: input.actions,
      grantedBy: principal.id,
      expiresAt,
      passwordHash,
      label,
      tokenEnc: await encryptToken(secret, token),
      reviewMode: input.reviewMode ?? null,
    },
    now,
  );
  return { grantId, token, hasPassword: passwordHash !== null, label, expiresAt };
}

/**
 * Resolve a presented share-link token to its unexpired grant, or null for
 * unknown/expired/revoked alike. Deliberately UN-GATED — the token IS the
 * credential (invite-token precedent); the actual content read still runs
 * through `authorize()` with the link identity on the principal.
 */
export async function resolveShareLink(
  db: Database,
  token: string,
  now: string,
): Promise<grantQ.ItemGrantRecord | null> {
  return grantQ.findLinkGrantByHash(db, await hashToken(token), now);
}

/**
 * Resolve a share-link token to its OPEN/LOCKED/absent state (D51). A grant
 * with no password is always 'open'. A grant WITH a password is 'open' only
 * when the presented `rm_unlock` cookie verifies against the grant's CURRENT
 * password hash (`share-unlock.ts` — a password change or revoke invalidates
 * every outstanding cookie because the hash it was signed against is gone).
 * The route uses this exclusively (never `resolveShareLink` directly) so the
 * password check can never be forgotten.
 */
export async function openShareLink(
  db: Database,
  token: string,
  unlockCookie: string | undefined,
  secret: string,
  now: string,
): Promise<{ state: 'open' | 'locked'; grant: grantQ.ItemGrantRecord } | null> {
  const found = await grantQ.findLinkGrantWithHashByTokenHash(db, await hashToken(token), now);
  if (!found) return null;
  const { grant, passwordHash } = found;
  if (!grant.hasPassword) return { state: 'open', grant };
  // Fail CLOSED, not open: `hasPassword` said yes but the hash didn't come
  // back (deleted out from under the grant, storage inconsistency, …) — never
  // treat that as "no password required" (fail closed).
  if (!passwordHash) return { state: 'locked', grant };
  const unlocked = await verifyUnlock(secret, grant.id, passwordHash, unlockCookie ?? '', now);
  return { state: unlocked ? 'open' : 'locked', grant };
}

/**
 * Verify a presented password against a share link's token and, on success,
 * mint the `rm_unlock` cookie value + its max-age. Unknown token, expired
 * grant, no password on the grant, or a wrong password are all
 * indistinguishable `{ ok: false }` — no enumeration oracle.
 */
export async function unlockShareLink(
  db: Database,
  token: string,
  password: string,
  secret: string,
  now: string,
): Promise<{ ok: true; cookieValue: string; maxAgeSeconds: number } | { ok: false }> {
  if (!password) return { ok: false };
  const found = await grantQ.findLinkGrantWithHashByTokenHash(db, await hashToken(token), now);
  if (!found || !found.grant.hasPassword || !found.passwordHash) return { ok: false };
  const { grant, passwordHash } = found;
  if (!verifyPassword(password, passwordHash)) return { ok: false };

  const DAY_SECONDS = 24 * 60 * 60;
  const untilExpiry = grant.expiresAt
    ? Math.floor((new Date(grant.expiresAt).getTime() - new Date(now).getTime()) / 1000)
    : DAY_SECONDS;
  const maxAgeSeconds = Math.max(1, Math.min(DAY_SECONDS, untilExpiry));
  const exp = new Date(new Date(now).getTime() + maxAgeSeconds * 1000).toISOString();
  const cookieValue = await signUnlock(secret, grant.id, passwordHash, exp);
  return { ok: true, cookieValue, maxAgeSeconds };
}

/** A share-link grant as listed in the Share panel — `url` is the decrypted,
 *  ready-to-copy link (D53), or null when it can't be recovered: a legacy row
 *  minted before `token_enc` existed, or decryption failed (wrong/rotated
 *  secret, tampered ciphertext). Never carries the hash or the ciphertext
 *  itself. */
export interface ShareLinkListItem extends grantQ.ItemGrantRecord {
  readonly url: string | null;
}

/** List only the LINK grants on a document (Share panel's "Share links"
 *  section), each with its re-copyable URL (D53). Gated on `share_link` —
 *  anyone who can mint links can see the ones already minted, without needing
 *  install-wide `manage_access`. */
export async function listShareLinks(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  secret: string,
  baseUrl: string,
  now: string,
): Promise<ShareLinkListItem[]> {
  await authorize(db, principal, 'share_link', { collection, documentId }, now);
  const links = await grantQ.listLinkGrantsForDocument(db, documentId, now);
  return Promise.all(
    links.map(async ({ tokenEnc, ...grant }) => {
      const token = tokenEnc ? await decryptToken(secret, tokenEnc) : null;
      return { ...grant, url: token ? `${baseUrl}/s/${token}` : null };
    }),
  );
}

/** Revoke a share LINK grant — gated on `share_link` (the same capability
 *  that mints them), and rejects revoking any other grant kind or a grant
 *  belonging to a different document (both surfaced as NotFound, no detail). */
export async function revokeShareLink(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  grantId: string,
  now: string,
): Promise<void> {
  await authorize(db, principal, 'share_link', { collection, documentId }, now);
  const grants = await grantQ.listGrantsForDocument(db, documentId);
  const grant = grants.find((g) => g.id === grantId);
  if (!grant || grant.subjectKind !== 'link') throw new NotFoundError('Share link');
  await grantQ.revokeItemGrant(db, grantId);
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Email a just-minted share link (the admin Share panel's "Send" action,
 * D51). Gated on `share_link` — the SAME capability that mints links, not a
 * bare "logged in" check — so a document's viewer can't turn the panel into
 * an arbitrary spam/phishing relay by pasting any URL and any address. `url`
 * MUST be exactly `${baseUrl}/s/<token>` for THIS install (never an arbitrary
 * redirect target), and `email` must look like an email address.
 */
export async function emailShareLink(
  db: Database,
  principal: Principal,
  input: { collection: string; documentId: string; url: string; email: string; baseUrl: string },
  transport: EmailTransport,
  siteName: string | undefined,
  now: string,
): Promise<void> {
  await authorize(db, principal, 'share_link', { collection: input.collection, documentId: input.documentId }, now);

  const urlPattern = new RegExp(`^${escapeRegExp(input.baseUrl)}/s/[A-Za-z0-9_-]+$`);
  if (!urlPattern.test(input.url)) {
    throw new InputValidationError([{ path: 'url', message: 'Not a valid share link for this install.' }]);
  }
  if (!EMAIL_RE.test(input.email)) {
    throw new InputValidationError([{ path: 'email', message: 'Enter a valid email address.' }]);
  }

  await transport.send({ to: input.email, ...shareNotificationEmail({ url: input.url, siteName }) });
}

/** Every item grant in the install (for the access overview). Requires install-wide
 *  `manage_access`. */
export async function listAllItemGrants(
  db: Database,
  principal: Principal,
  now: string,
): Promise<grantQ.ItemGrantRecord[]> {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return grantQ.listAllGrants(db);
}

/** List the item grants on a document (for the People & roles section of the
 *  Share surface). Requires `manage_access` on that document — the same gate
 *  that grants/revokes them. Excludes `link` grants (D51) — those are share
 *  links, shown exclusively in the dedicated Share links section
 *  (`listShareLinks`); listing them here too duplicated the row (with a
 *  nonsensical "link" persona and a raw token hash as the subject) and gave
 *  it a second, differently-behaved Revoke control. */
export async function listItemGrants(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  now: string,
): Promise<grantQ.ItemGrantRecord[]> {
  await authorize(db, principal, 'manage_access', { collection, documentId }, now);
  return grantQ.listNonLinkGrantsForDocument(db, documentId);
}

export async function listAudit(db: Database, principal: Principal, now: string, limit = 100) {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return recentAudit(db, limit);
}

/** Filtered + keyset-paginated audit page (the /admin/activity surface + REST
 *  /api/audit + MCP list_audit). Gated `manage_access` like every audit read. */
export async function listAuditPage(
  db: Database,
  principal: Principal,
  params: {
    readonly filters?: auditQ.AuditFilters;
    readonly cursor?: string;
    readonly limit?: number;
  },
  now: string,
) {
  await authorize(db, principal, 'manage_access', ROOT, now);
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const cursor = params.cursor ? decodeAuditCursor(params.cursor) : undefined;
  const rows = await auditQ.listAuditPage(db, { filters: params.filters, cursor, limit });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? btoa(`${last.createdAt}|${last.id}`) : undefined;
  return { rows: page, limit, nextCursor };
}

function decodeAuditCursor(s: string): auditQ.AuditCursor | undefined {
  try {
    const raw = atob(s);
    const i = raw.indexOf('|');
    if (i < 0) return undefined;
    return { createdAt: raw.slice(0, i), id: raw.slice(i + 1) };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Principals + tokens
// ---------------------------------------------------------------------------

/** What the caller is: identity, role assignments, the permissions they
 *  resolve to, and the token's narrowing mask. */
export interface SelfDescription {
  readonly principal: { readonly id: string; readonly name: string; readonly kind: string; readonly persona: Persona | null };
  readonly roles: readonly { readonly role: string; readonly collection: string }[];
  readonly permissions: readonly { readonly collection: string; readonly action: Action; readonly condition: Condition | null }[];
  readonly tokenScope: readonly { readonly collection: string; readonly action: Action }[] | null;
  readonly oauthClient: string | null;
}

/** The caller's own identity and permissions (`whoami` / `GET /api/me`).
 *  Identity-scoped like /admin/account — no `authorize()`: it reveals only what
 *  the caller already holds, so an agent can tell why a call was refused.
 *  Permissions are role-derived; per-document item grants aren't listed. */
export async function describeSelf(db: Database, principal: Principal): Promise<SelfDescription> {
  const record = principal.kind === 'system' ? null : await principalQ.getPrincipal(db, principal.id);
  return {
    principal: {
      id: principal.id,
      name: record?.name ?? principal.id,
      kind: principal.kind,
      persona: record ? personaOf(record.kind, record.subtype) : null,
    },
    roles: record?.roles ?? [],
    permissions: record ? await roleQ.getPrincipalPermissions(db, principal.id) : [],
    tokenScope: principal.tokenScope ?? null,
    oauthClient: record ? await clientNameForPrincipal(db, principal.id) : null,
  };
}

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

/**
 * The connect-wizard path (D48): principal + role + token in one atomic step,
 * collapsing the old create-agent → assign-role → issue-token trek. Same gate
 * as issueToken (human-only, manage_access, audited once). Unlike the OAuth
 * consent screen, the wizard MAY grant `admin` — it is the sanctioned path for
 * full-admin agents. Returns the plaintext token exactly once.
 */
export async function connectAgent(
  db: Database,
  principal: Principal,
  input: {
    name: string;
    role: string;
    roleCollection?: string;
    scope?: { collection: string; action: Action }[];
    subtype?: MachinePersona;
  },
  now: string,
): Promise<{ principalId: string; tokenId: string; token: string }> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);

  const name = input.name.trim();
  const issues: ErrorDetails[] = [];
  if (!name) issues.push({ path: 'name', message: 'Name is required.' });
  const roles = await roleQ.listRoles(db);
  if (input.role === 'anonymous' || !roles.some((r) => r.slug === input.role)) {
    issues.push({ path: 'role', message: `Unknown role '${input.role}'.` });
  }
  const badScope = (input.scope ?? []).filter((s) => !ACTIONS.includes(s.action));
  issues.push(...badScope.map((s) => ({ path: 'scope', message: `Unknown action '${s.action}'.` })));
  if (issues.length) throw new InputValidationError(issues, 'Invalid agent connection');

  const token = generateToken();
  const { principalId, tokenId } = await principalQ.createAgentWithToken(
    db,
    {
      name,
      subtype: input.subtype ?? 'agent',
      role: input.role,
      roleCollection: input.roleCollection?.trim() || '*',
      tokenName: `${name} token`,
      tokenHash: await hashToken(token),
      scope: input.scope?.length ? input.scope : null,
      expiresAt: null,
    },
    now,
  );
  return { principalId, tokenId, token };
}

// ---------------------------------------------------------------------------
// Teams (D24) — named groups of principals used as item-grant subjects.
// Teams never carry role permissions; a team grant only ADDs read (etc.) on one
// document. All mutations are manage_access-gated and human-only (SEC-8).
// ---------------------------------------------------------------------------

const TEAM_INVITE_MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000; // join links expire in ≤ 90 days

/** Un-gated name/id listing (mirrors listRoles): subject pickers need the names;
 *  membership and invites stay behind manage_access below. */
export const listTeams = teamQ.listTeams;

export async function createTeam(
  db: Database,
  principal: Principal,
  input: { name: string; description?: string },
  now: string,
): Promise<string> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  const name = input.name.trim();
  if (!name) throw new InputValidationError([{ path: 'name', message: 'Team name is required.' }]);
  return teamQ.createTeam(db, name, input.description?.trim() || null, now);
}

/** Deleting a team also revokes its item grants — memberships/invites cascade in
 *  the DB, but grants are kind-polymorphic (no FK) and must not linger as inert
 *  rows that would silently re-activate if a team id were ever reused. */
export async function deleteTeam(db: Database, principal: Principal, teamId: string, now: string): Promise<void> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  await grantQ.revokeGrantsForSubject(db, 'team', teamId);
  await teamQ.deleteTeam(db, teamId);
}

export async function addTeamMember(
  db: Database,
  principal: Principal,
  teamId: string,
  memberPrincipalId: string,
  now: string,
): Promise<void> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  if (!(await teamQ.getTeam(db, teamId))) throw new NotFoundError('Team');
  if (!(await principalQ.getPrincipal(db, memberPrincipalId))) throw new NotFoundError('Principal');
  await teamQ.addTeamMember(db, teamId, memberPrincipalId, principal.id, now);
}

export async function removeTeamMember(
  db: Database,
  principal: Principal,
  teamId: string,
  memberPrincipalId: string,
  now: string,
): Promise<void> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  await teamQ.removeTeamMember(db, teamId, memberPrincipalId);
}

export async function listTeamMembers(db: Database, principal: Principal, teamId: string, now: string) {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return teamQ.listTeamMembers(db, teamId);
}

/**
 * Mint a multi-use team-join link. The role preset is what joiners get assigned
 * (picked by the admin, default `reader`); expiry is REQUIRED and clamped to 90
 * days. Returns the plaintext token exactly once — only its hash is stored.
 */
export async function createTeamInvite(
  db: Database,
  principal: Principal,
  input: { teamId: string; role?: string; maxUses?: number; expiresAt: string },
  now: string,
): Promise<{ inviteId: string; token: string }> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  if (!(await teamQ.getTeam(db, input.teamId))) throw new NotFoundError('Team');

  const role = input.role?.trim() || 'reader';
  const issues: ErrorDetails[] = [];
  if (role === 'anonymous' || !(await roleQ.getRole(db, role))) {
    issues.push({ path: 'role', message: `Unknown role '${role}'.` });
  }
  if (input.maxUses !== undefined && (!Number.isInteger(input.maxUses) || input.maxUses <= 0)) {
    issues.push({ path: 'maxUses', message: 'Max uses must be a positive integer.' });
  }
  const expires = Date.parse(input.expiresAt ?? '');
  if (Number.isNaN(expires) || expires <= new Date(now).getTime()) {
    issues.push({ path: 'expiresAt', message: 'A future expiry is required.' });
  }
  if (issues.length) throw new InputValidationError(issues, 'Invalid invite');

  const clamped = Math.min(expires, new Date(now).getTime() + TEAM_INVITE_MAX_TTL_MS);
  const token = generateJoinToken();
  const inviteId = await teamQ.createTeamInviteRow(
    db,
    {
      teamId: input.teamId,
      tokenHash: await hashToken(token),
      role,
      maxUses: input.maxUses ?? null,
      expiresAt: new Date(clamped).toISOString(),
      createdBy: principal.id,
    },
    now,
  );
  return { inviteId, token };
}

export async function listTeamInvites(db: Database, principal: Principal, teamId: string, now: string) {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return teamQ.listTeamInvites(db, teamId);
}

export async function revokeTeamInvite(db: Database, principal: Principal, inviteId: string, now: string): Promise<void> {
  refuseAgentEscalation(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  await teamQ.revokeTeamInvite(db, inviteId, now);
}

/** Whether a join token is currently usable (for the GET form). Un-gated; one
 *  boolean, no detail — unknown/revoked/expired/spent are indistinguishable. */
export async function teamInviteIsValid(db: Database, token: string, now: string): Promise<boolean> {
  return (await teamQ.findValidTeamInviteByHash(db, await hashToken(token), now)) !== null;
}

/**
 * Consume a team-join link: create the person, assign the invite's role preset,
 * add them to the team, count the use. Deliberately UN-GATED — the token IS the
 * credential (invite-token precedent, src/services/invites). An existing email
 * is a ConflictError: possessing a join link proves nothing about mailbox
 * ownership, so it must never attach an existing account to a team.
 */
export async function acceptTeamInvite(
  db: Database,
  token: string,
  input: { name: string; email: string; password: string },
  now: string,
): Promise<{ principalId: string }> {
  const invite = await teamQ.findValidTeamInviteByHash(db, await hashToken(token), now);
  if (!invite) throw new ForbiddenError('This invite link is invalid or has expired.');

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const issues: ErrorDetails[] = [];
  if (!name) issues.push({ path: 'name', message: 'Name is required.' });
  if (!EMAIL_RE.test(email)) issues.push({ path: 'email', message: 'A valid email is required.' });
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    issues.push({ path: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }
  if (issues.length) throw new InputValidationError(issues, 'Invalid registration');

  if (await getUserByEmail(db, email)) {
    throw new ConflictError('An account with this email already exists. Sign in and ask an admin to add you to the team.');
  }

  const principalId = await principalQ.createUserPrincipal(db, { name, email, passwordHash: hashPassword(input.password) }, now);
  // No acting principal here — the consumed token is the authority (invite
  // precedent): assign the preset via the query layer, never via assignRole().
  await roleQ.assignRole(db, principalId, invite.role, '*');
  await teamQ.addTeamMember(db, invite.teamId, principalId, null, now);
  await teamQ.incrementTeamInviteUse(db, invite.id);
  return { principalId };
}
