/**
 * Seed the system roles + their permissions (steering/ACCESS_CONTROL.md). Used by
 * tests and by the app bootstrap. The production seed.sql mirrors this data (kept
 * in sync manually — it is static). Idempotent per fresh DB (tests create one per
 * case); re-seeding an existing DB would duplicate rows, so call once.
 */

import type { Database } from '@/db/client';
import { insertRole, assignRole } from '@/db/queries/roles';
import { SYSTEM_ROLES } from '@/access/policy';

/** Insert all system roles + permissions. */
export async function seedSystemRoles(db: Database, now: string): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await insertRole(db, role, true, now);
  }
}

/** Convenience for tests/bootstrap: seed roles and grant a principal the admin role. */
export async function seedRolesAndAdmin(db: Database, adminPrincipalId: string, now: string): Promise<void> {
  await seedSystemRoles(db, now);
  await assignRole(db, adminPrincipalId, 'admin', '*');
}
