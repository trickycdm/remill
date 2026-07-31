/**
 * Test helpers for the access model: seed the system roles, and mint a principal
 * that exists in the DB with a role assignment. Keeps every test's setup honest —
 * permissions come from `principal_roles`, exactly as production resolves them.
 */

import type { Database } from '@/db/client';
import { principals } from '@/db/schema';
import { seedSystemRoles } from '@/access/seed';
import { assignRole } from '@/db/queries/roles';
import type { Principal } from '@/access';
import type { TokenScopeEntry } from '@/access';

export async function seedRoles(db: Database, now: string): Promise<void> {
  await seedSystemRoles(db, now);
}

export interface MakePrincipalOpts {
  readonly id: string;
  readonly kind?: 'user' | 'agent';
  readonly role?: string; // system or custom role slug; omit for an unprivileged principal
  readonly collection?: string; // assignment scope
  readonly surface?: 'admin' | 'rest' | 'mcp';
  readonly tokenScope?: readonly TokenScopeEntry[];
}

/** Insert a principal row + (optional) role assignment; return the Principal. */
export async function makePrincipal(db: Database, now: string, opts: MakePrincipalOpts): Promise<Principal> {
  const kind = opts.kind ?? 'user';
  await db
    .insert(principals)
    .values({ id: opts.id, kind, name: opts.id, disabled: 0, createdAt: now })
    .onConflictDoNothing();
  if (opts.role) await assignRole(db, opts.id, opts.role, opts.collection ?? '*');
  return { id: opts.id, kind, surface: opts.surface ?? 'admin', tokenScope: opts.tokenScope };
}
