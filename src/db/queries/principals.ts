/**
 * Principal + token queries. Principals are the unified actor model (human or
 * agent); tokens belong to a principal and are hashed at rest (ACCESS_CONTROL.md,
 * SECURITY_STANDARDS.md).
 */

import { eq, desc, and } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { principals, users, apiTokens, principalRoles } from '@/db/schema';
import { newId } from '@/lib/id';

export interface PrincipalRecord {
  readonly id: string;
  readonly kind: 'user' | 'agent';
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

/** Create an agent principal (agents have no password; they authenticate by token). */
export async function createAgentPrincipal(db: Database, name: string, now: string): Promise<string> {
  const id = newId('principal');
  await db.insert(principals).values({ id, kind: 'agent', name, disabled: 0, createdAt: now });
  return id;
}

export async function setPrincipalDisabled(db: Database, id: string, disabled: boolean): Promise<void> {
  await db.update(principals).set({ disabled: disabled ? 1 : 0 }).where(eq(principals.id, id));
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

/** Resolve a token by its hash (for REST/MCP auth in Phase 6/7). Updates last_used. */
export async function findTokenByHash(db: Database, tokenHash: string, now: string) {
  const rows = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).limit(1);
  const t = rows[0];
  if (!t) return null;
  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, t.id));
  return {
    id: t.id,
    principalId: t.principalId,
    scope: t.scopeJson ? (JSON.parse(t.scopeJson) as { collection: string; action: string }[]) : null,
    expiresAt: t.expiresAt,
  };
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
