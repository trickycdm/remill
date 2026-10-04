/**
 * Passkey queries (D58) — WebAuthn credentials and their single-use challenges.
 * Row↔domain mapping is private here (steering/DATABASE_STANDARDS.md). Every
 * mutation of a passkey is scoped by `principalId`, so a caller can only ever
 * touch its own credentials.
 */

import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { passkeys, webauthnChallenges } from '@/db/schema';
import { newId } from '@/lib/id';

export type ChallengePurpose = 'register' | 'authenticate';

export interface PasskeyRecord {
  readonly id: string;
  readonly principalId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports: readonly string[];
  readonly backedUp: boolean;
  readonly name: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface ChallengeRecord {
  readonly purpose: ChallengePurpose;
  readonly principalId: string | null;
}

function toRecord(row: typeof passkeys.$inferSelect): PasskeyRecord {
  return {
    id: row.id,
    principalId: row.principalId,
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: parseTransports(row.transportsJson),
    backedUp: row.backedUp === 1,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

function parseTransports(json: string | null): readonly string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function insertPasskey(
  db: Database,
  input: {
    principalId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: readonly string[];
    deviceType: string;
    backedUp: boolean;
    name: string;
    now: string;
  },
): Promise<string> {
  const id = newId('passkey');
  await db.insert(passkeys).values({
    id,
    principalId: input.principalId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    counter: input.counter,
    transportsJson: JSON.stringify(input.transports),
    deviceType: input.deviceType,
    backedUp: input.backedUp ? 1 : 0,
    name: input.name,
    createdAt: input.now,
    lastUsedAt: null,
  });
  return id;
}

/** A principal's passkeys, oldest first. */
export async function listPasskeysByPrincipal(db: Database, principalId: string): Promise<PasskeyRecord[]> {
  const rows = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.principalId, principalId))
    .orderBy(asc(passkeys.createdAt));
  return rows.map(toRecord);
}

export async function findPasskeyByCredentialId(db: Database, credentialId: string): Promise<PasskeyRecord | null> {
  const rows = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Record a successful sign-in: the new signature counter and backup state. */
export async function updatePasskeyUsage(
  db: Database,
  id: string,
  input: { counter: number; backedUp: boolean; now: string },
): Promise<void> {
  await db
    .update(passkeys)
    .set({ counter: input.counter, backedUp: input.backedUp ? 1 : 0, lastUsedAt: input.now })
    .where(eq(passkeys.id, id));
}

/** Rename one of `principalId`'s passkeys. Returns false when it is not theirs. */
export async function renamePasskey(db: Database, principalId: string, id: string, name: string): Promise<boolean> {
  const rows = await db
    .update(passkeys)
    .set({ name })
    .where(and(eq(passkeys.id, id), eq(passkeys.principalId, principalId)))
    .returning({ id: passkeys.id });
  return rows.length > 0;
}

/** Delete one of `principalId`'s passkeys. Returns false when it is not theirs. */
export async function deletePasskey(db: Database, principalId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.principalId, principalId)))
    .returning({ id: passkeys.id });
  return rows.length > 0;
}

export async function insertChallenge(
  db: Database,
  input: { challenge: string; purpose: ChallengePurpose; principalId: string | null; expiresAt: string; now: string },
): Promise<void> {
  await db.insert(webauthnChallenges).values({
    challenge: input.challenge,
    purpose: input.purpose,
    principalId: input.principalId,
    expiresAt: input.expiresAt,
    createdAt: input.now,
  });
}

/**
 * Consume a challenge: delete it and return what it was issued for, or null when
 * it is unknown, already used, or expired. ONE statement, so two concurrent
 * requests can never both consume the same challenge (single-use, no replay).
 */
export async function consumeChallenge(db: Database, challenge: string, now: string): Promise<ChallengeRecord | null> {
  const rows = await db
    .delete(webauthnChallenges)
    .where(and(eq(webauthnChallenges.challenge, challenge), gt(webauthnChallenges.expiresAt, now)))
    .returning({ purpose: webauthnChallenges.purpose, principalId: webauthnChallenges.principalId });
  const row = rows[0];
  if (!row) return null;
  return { purpose: row.purpose as ChallengePurpose, principalId: row.principalId };
}

/** Delete challenges that expired unused. Returns how many were removed. */
export async function purgeExpiredChallenges(db: Database, now: string): Promise<number> {
  const rows = await db
    .delete(webauthnChallenges)
    .where(lte(webauthnChallenges.expiresAt, now))
    .returning({ challenge: webauthnChallenges.challenge });
  return rows.length;
}
