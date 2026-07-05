/**
 * Invite-token queries — single-use, expiring set-password links (ACCESS_CONTROL.md,
 * SECURITY_STANDARDS.md). Only the SHA-256 hash is stored; the plaintext is shown
 * once and embedded in the link. Consuming a token is single-use (consumed_at set)
 * and never widens access — it only lets an invited human set their own password.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { inviteTokens } from '@/db/schema';
import { newId } from '@/lib/id';

export interface InviteRecord {
  readonly id: string;
  readonly principalId: string;
  readonly purpose: string;
}

/** Create an invite token row (stores the hash). Returns the new row id. */
export async function createInviteToken(
  db: Database,
  input: { principalId: string; tokenHash: string; purpose?: string; expiresAt: string; now: string },
): Promise<string> {
  const id = newId('invite');
  await db.insert(inviteTokens).values({
    id,
    principalId: input.principalId,
    tokenHash: input.tokenHash,
    purpose: input.purpose ?? 'set_password',
    expiresAt: input.expiresAt,
    consumedAt: null,
    createdAt: input.now,
  });
  return id;
}

/**
 * Resolve a still-valid invite by its token hash: exists, not consumed, not expired
 * (as of `now`). Returns null otherwise — callers must not distinguish "unknown"
 * from "expired/consumed" to the client (avoid an enumeration/oracle signal).
 */
export async function findValidInviteByHash(db: Database, tokenHash: string, now: string): Promise<InviteRecord | null> {
  const rows = await db.select().from(inviteTokens).where(eq(inviteTokens.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.consumedAt) return null;
  if (row.expiresAt <= now) return null;
  return { id: row.id, principalId: row.principalId, purpose: row.purpose };
}

/** Mark an invite consumed (single-use). Call inside the same flow as the password set. */
export async function markInviteConsumed(db: Database, id: string, now: string): Promise<void> {
  await db.update(inviteTokens).set({ consumedAt: now }).where(eq(inviteTokens.id, id));
}
