/**
 * Principal + token queries. Principals are the unified actor model (human or
 * agent); tokens belong to a principal and are hashed at rest (ACCESS_CONTROL.md,
 * SECURITY_STANDARDS.md).
 */

import { eq, desc, and } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { principals, users, apiTokens, principalRoles } from '@/db/schema';
import { newId } from '@/lib/id';
import type { MachinePersona } from '@/lib/persona';

export interface PrincipalRecord {
  readonly id: string;
  readonly kind: 'user' | 'agent';
  readonly subtype: string | null; // persona hint: 'person' | 'service' | 'agent' | null
  readonly name: string;
  readonly disabled: boolean;
  readonly email: string | null; // present for kind 'user'
  readonly roles: { role: string; collection: string }[];
}

export async function listPrincipals(db: Database): Promise<PrincipalRecord[]> {
  const rows = await db.select().from(principals).orderBy(principals.createdAt);
  const userRows = await db.select().from(users);
  const roleRows = await db.select().from(principalRoles);
  const emailById = new Map(userRows.map((u) => [u.principalId, u.email]));
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind as 'user' | 'agent',
    subtype: p.subtype ?? null,
    name: p.name,
    disabled: p.disabled === 1,
    email: emailById.get(p.id) ?? null,
    roles: roleRows.filter((r) => r.principalId === p.id).map((r) => ({ role: r.role, collection: r.collection })),
  }));
}

export async function getPrincipal(db: Database, id: string): Promise<PrincipalRecord | null> {
  const list = await listPrincipals(db);
  return list.find((p) => p.id === id) ?? null;
}

/** Create a machine principal (service or agent — both `kind: 'agent'`, no
 *  password; they authenticate by token). `subtype` records the persona. */
export async function createAgentPrincipal(
  db: Database,
  name: string,
  now: string,
  subtype: MachinePersona = 'agent',
): Promise<string> {
  const id = newId('principal');
  await db.insert(principals).values({ id, kind: 'agent', subtype, name, disabled: 0, createdAt: now });
  return id;
}

/**
 * Create a human principal + its credential row atomically (the invite/create-user
 * path). `email` must already be normalized (trim + lowercase) and `passwordHash` a
 * scrypt `saltHex:hashHex` — the service layer owns validation/uniqueness. Returns
 * the new principal id. Mirrors the three-row bootstrap pattern, minus the role
 * assignment (the service assigns the initial role).
 */
export async function createUserPrincipal(
  db: Database,
  input: { name: string; email: string; passwordHash: string },
  now: string,
): Promise<string> {
  const id = newId('principal');
  await db.batch([
    db.insert(principals).values({ id, kind: 'user', subtype: 'person', name: input.name, disabled: 0, createdAt: now }),
    db.insert(users).values({ principalId: id, email: input.email, passwordHash: input.passwordHash, createdAt: now }),
  ]);
  return id;
}

export async function setPrincipalDisabled(db: Database, id: string, disabled: boolean): Promise<void> {
  await db.update(principals).set({ disabled: disabled ? 1 : 0 }).where(eq(principals.id, id));
}

/** Update a principal's display name (the human's shown name / an agent's label). */
export async function updatePrincipalName(db: Database, id: string, name: string): Promise<void> {
  await db.update(principals).set({ name }).where(eq(principals.id, id));
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface TokenRecord {
  readonly id: string;
  readonly principalId: string;
  readonly name: string;
  readonly scope: { collection: string; action: string }[] | null;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export async function listTokens(db: Database, principalId?: string): Promise<TokenRecord[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(principalId ? eq(apiTokens.principalId, principalId) : undefined)
    .orderBy(desc(apiTokens.createdAt));
  return rows.map((t) => ({
    id: t.id,
    principalId: t.principalId,
    name: t.name,
    scope: t.scopeJson ? JSON.parse(t.scopeJson) : null,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
  }));
}

export async function insertToken(
  db: Database,
  input: {
    principalId: string;
    name: string;
    tokenHash: string;
    scope: { collection: string; action: string }[] | null;
    expiresAt: string | null;
    now: string;
  },
): Promise<string> {
  const id = newId('token');
  await db.insert(apiTokens).values({
    id,
    principalId: input.principalId,
    name: input.name,
    tokenHash: input.tokenHash,
    scopeJson: input.scope ? JSON.stringify(input.scope) : null,
    expiresAt: input.expiresAt,
    lastUsedAt: null,
    createdAt: input.now,
  });
  return id;
}

export async function revokeToken(db: Database, id: string): Promise<void> {
  await db.delete(apiTokens).where(eq(apiTokens.id, id));
}

/**
 * Resolve a token by its hash (for REST/MCP auth). READ-ONLY: it does NOT stamp
 * `last_used_at`. Stamping happens via `stampTokenUsed` only AFTER the caller has
 * confirmed the token is valid (not expired) and its principal is active (SEC-7) —
 * otherwise a matched-but-invalid token would leak a usage signal. (`_now` is
 * accepted-but-ignored, retained only for existing call-site arity.)
 */
export async function findTokenByHash(db: Database, tokenHash: string, _now?: string) {
  const rows = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).limit(1);
  const t = rows[0];
  if (!t) return null;
  return {
    id: t.id,
    principalId: t.principalId,
    scope: t.scopeJson ? (JSON.parse(t.scopeJson) as { collection: string; action: string }[]) : null,
    expiresAt: t.expiresAt,
  };
}

/** Stamp a token's `last_used_at` — call ONLY after validity + active checks pass. */
export async function stampTokenUsed(db: Database, id: string, now: string): Promise<void> {
  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, id));
}

/** True if the principal exists and is not disabled. */
export async function isPrincipalActive(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .select({ disabled: principals.disabled })
    .from(principals)
    .where(and(eq(principals.id, id), eq(principals.disabled, 0)))
    .limit(1);
  return rows.length > 0;
}
