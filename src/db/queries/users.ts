/**
 * User + principal read queries. The ONLY layer (with the rest of src/db/queries/)
 * that imports Drizzle. Row↔domain mapping is private here — no Drizzle row types
 * leak upward (steering/DATABASE_STANDARDS.md).
 */

import { eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { users, principals } from '@/db/schema';

/** A human user joined to its principal, as the auth service needs it at login. */
export interface UserRecord {
  readonly principalId: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly disabled: boolean;
}

/** Look up a user by email (case-insensitive), joined to its principal, or null. */
export async function getUserByEmail(db: Database, email: string): Promise<UserRecord | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select({
      principalId: users.principalId,
      email: users.email,
      passwordHash: users.passwordHash,
      displayName: principals.name,
      disabled: principals.disabled,
    })
    .from(users)
    .innerJoin(principals, eq(principals.id, users.principalId))
    .where(eq(users.email, normalized))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    principalId: row.principalId,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    disabled: row.disabled === 1,
  };
}
