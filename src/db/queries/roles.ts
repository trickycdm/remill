/**
 * Role + assignment queries (steering/ACCESS_CONTROL.md). The permission
 * resolution here is the raw material the decision function consumes.
 */

import { eq, and } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { roles, rolePermissions, principalRoles } from '@/db/schema';
import { newId } from '@/lib/id';
import type { Action, Condition } from '@/access/types';
import { SYSTEM_ROLE_SLUGS, type PermissionSpec, type RoleSpec } from '@/access/policy';

export interface RoleRecord {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly system: boolean;
  readonly permissions: PermissionSpec[];
}

/** One effective permission a principal holds, after applying assignment scope. */
export interface EffectivePermission {
  readonly collection: string; // '*' or a slug
  readonly action: Action;
  readonly condition: Condition | null;
}

export async function listRoles(db: Database): Promise<RoleRecord[]> {
  const roleRows = await db.select().from(roles).orderBy(roles.slug);
  const permRows = await db.select().from(rolePermissions);
  return roleRows.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    system: r.system === 1,
    permissions: permRows
      .filter((p) => p.role === r.slug)
      .map((p) => ({ collection: p.collection, action: p.action as Action, condition: (p.condition as Condition) ?? undefined })),
  }));
}

export async function getRole(db: Database, slug: string): Promise<RoleRecord | null> {
  const r = (await db.select().from(roles).where(eq(roles.slug, slug)).limit(1))[0];
  if (!r) return null;
  const perms = await db.select().from(rolePermissions).where(eq(rolePermissions.role, slug));
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    system: r.system === 1,
    permissions: perms.map((p) => ({ collection: p.collection, action: p.action as Action, condition: (p.condition as Condition) ?? undefined })),
  };
}

export async function insertRole(db: Database, spec: RoleSpec, system: boolean, now: string): Promise<void> {
  await db.batch([
    db.insert(roles).values({ slug: spec.slug, name: spec.name, description: spec.description, system: system ? 1 : 0, createdAt: now }),
    ...spec.permissions.map((p) =>
      db.insert(rolePermissions).values({ id: newId('rolePermission'), role: spec.slug, collection: p.collection, action: p.action, condition: p.condition ?? null }),
    ),
  ] as [import('drizzle-orm/batch').BatchItem<'sqlite'>, ...import('drizzle-orm/batch').BatchItem<'sqlite'>[]]);
}

/** Replace a role's permission set (used by the roles service on update). */
export async function setRolePermissions(db: Database, slug: string, name: string, description: string | undefined, perms: PermissionSpec[]): Promise<void> {
  const inserts = perms.map((p) =>
    db.insert(rolePermissions).values({ id: newId('rolePermission'), role: slug, collection: p.collection, action: p.action, condition: p.condition ?? null }),
  );
  await db.batch([
    db.update(roles).set({ name, description: description ?? null }).where(eq(roles.slug, slug)),
    db.delete(rolePermissions).where(eq(rolePermissions.role, slug)),
    ...inserts,
  ] as [import('drizzle-orm/batch').BatchItem<'sqlite'>, ...import('drizzle-orm/batch').BatchItem<'sqlite'>[]]);
}

export async function deleteRole(db: Database, slug: string): Promise<void> {
  await db.delete(roles).where(eq(roles.slug, slug));
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function assignRole(db: Database, principalId: string, role: string, collection = '*'): Promise<void> {
  await db
    .insert(principalRoles)
    .values({ id: newId('principalRole'), principalId, role, collection })
    .onConflictDoNothing();
}

export async function unassignRole(db: Database, principalId: string, role: string, collection = '*'): Promise<void> {
  await db
    .delete(principalRoles)
    .where(and(eq(principalRoles.principalId, principalId), eq(principalRoles.role, role), eq(principalRoles.collection, collection)));
}

/** The role slugs a principal holds (for item-grant role matching). */
export async function getPrincipalRoleSlugs(db: Database, principalId: string): Promise<string[]> {
  const rows = await db.select({ role: principalRoles.role }).from(principalRoles).where(eq(principalRoles.principalId, principalId));
  return [...new Set(rows.map((r) => r.role))];
}

/**
 * Resolve a principal's effective permissions: every role_permission from every
 * assigned role, with the assignment scope folded into the permission's
 * collection. "editor, but only of posts" (scope=posts) × editor's (*, update)
 * yields (posts, update).
 */
export async function getPrincipalPermissions(db: Database, principalId: string): Promise<EffectivePermission[]> {
  const rows = await db
    .select({
      scope: principalRoles.collection,
      permCollection: rolePermissions.collection,
      action: rolePermissions.action,
      condition: rolePermissions.condition,
    })
    .from(principalRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.role, principalRoles.role))
    .where(eq(principalRoles.principalId, principalId));

  const out: EffectivePermission[] = [];
  for (const r of rows) {
    const collection = effectiveCollection(r.scope, r.permCollection);
    if (collection === null) continue; // scope mismatch — assignment doesn't cover this permission
    out.push({ collection, action: r.action as Action, condition: (r.condition as Condition) ?? null });
  }
  return out;
}

function effectiveCollection(scope: string, permCollection: string): string | null {
  if (scope === '*') return permCollection;
  if (permCollection === '*') return scope;
  return scope === permCollection ? scope : null;
}

// Strength order for picking a principal's coarse "primary" role (display/nav only;
// real decisions use the full permission set). Higher index = stronger. Derived
// from the policy (which declares roles strongest-first) rather than re-listed, so
// the two never drift; reversing yields weakest→strongest.
const ROLE_STRENGTH: readonly string[] = [...SYSTEM_ROLE_SLUGS].reverse();

/** The principal's strongest assigned system role, for the session's coarse role.
 *  Defaults to 'reader' when the principal holds only custom or no roles. */
export async function getPrimaryRole(db: Database, principalId: string): Promise<string> {
  const rows = await db
    .select({ role: principalRoles.role })
    .from(principalRoles)
    .where(eq(principalRoles.principalId, principalId));
  let best = 'reader';
  let bestRank = -1;
  for (const r of rows) {
    const rank = ROLE_STRENGTH.indexOf(r.role);
    if (rank > bestRank) {
      bestRank = rank;
      best = r.role;
    }
  }
  return best;
}
