/**
 * Team queries — named groups of principals used purely as item-grant subjects
 * (D24, steering/ACCESS_CONTROL.md). Teams never carry role permissions;
 * membership is resolved into `teamIds` and matched by `subjectMatchFor` in
 * grants.ts, so `decide()` is untouched.
 *
 * Team invites are multi-use, expiring join links: unlike invite_tokens (bound
 * to an existing principal, single-use), a join link creates the principal at
 * acceptance time and carries the team + role preset. Same token discipline:
 * only the SHA-256 hash at rest, plaintext shown once, no enumeration oracle.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { teams, teamMembers, teamInvites, principals } from '@/db/schema';
import { newId } from '@/lib/id';

export interface TeamRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
}

export interface TeamMemberRecord {
  readonly principalId: string;
  readonly name: string;
  readonly kind: 'user' | 'agent';
  readonly subtype: string | null;
}

export interface TeamInviteRecord {
  readonly id: string;
  readonly teamId: string;
  readonly role: string;
  readonly maxUses: number | null;
  readonly useCount: number;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

function inviteToDomain(r: typeof teamInvites.$inferSelect): TeamInviteRecord {
  return {
    id: r.id,
    teamId: r.teamId,
    role: r.role,
    maxUses: r.maxUses,
    useCount: r.useCount,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export async function createTeam(db: Database, name: string, description: string | null, now: string): Promise<string> {
  const id = newId('team');
  await db.insert(teams).values({ id, name, description, createdAt: now });
  return id;
}

export async function listTeams(db: Database): Promise<TeamRecord[]> {
  return db.select().from(teams).orderBy(teams.name);
}

export async function getTeam(db: Database, id: string): Promise<TeamRecord | null> {
  const rows = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Deleting a team cascades its memberships, invites, — but NOT its item grants
 *  (item_grants.subject_id is kind-polymorphic, no FK); callers revoke those. */
export async function deleteTeam(db: Database, id: string): Promise<void> {
  await db.delete(teams).where(eq(teams.id, id));
}

export async function addTeamMember(
  db: Database,
  teamId: string,
  principalId: string,
  addedBy: string | null,
  now: string,
): Promise<void> {
  await db
    .insert(teamMembers)
    .values({ id: newId('teamMember'), teamId, principalId, addedBy, createdAt: now })
    .onConflictDoNothing();
}

export async function removeTeamMember(db: Database, teamId: string, principalId: string): Promise<void> {
  await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.principalId, principalId)));
}

export async function listTeamMembers(db: Database, teamId: string): Promise<TeamMemberRecord[]> {
  const rows = await db
    .select({
      principalId: teamMembers.principalId,
      name: principals.name,
      kind: principals.kind,
      subtype: principals.subtype,
    })
    .from(teamMembers)
    .innerJoin(principals, eq(principals.id, teamMembers.principalId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(principals.name);
  // principals.kind is DB-CHECK-constrained to exactly these two values.
  return rows.map((r) => ({ ...r, kind: r.kind as 'user' | 'agent' }));
}

/** The team ids a principal belongs to — the subject-resolution input that
 *  `subjectMatchFor` matches team grants against. */
export async function getPrincipalTeamIds(db: Database, principalId: string): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.principalId, principalId));
  return rows.map((r) => r.teamId);
}

export async function createTeamInviteRow(
  db: Database,
  input: { teamId: string; tokenHash: string; role: string; maxUses: number | null; expiresAt: string; createdBy: string },
  now: string,
): Promise<string> {
  const id = newId('teamInvite');
  await db.insert(teamInvites).values({
    id,
    teamId: input.teamId,
    tokenHash: input.tokenHash,
    role: input.role,
    maxUses: input.maxUses,
    useCount: 0,
    expiresAt: input.expiresAt,
    revokedAt: null,
    createdBy: input.createdBy,
    createdAt: now,
  });
  return id;
}

/**
 * Resolve a still-valid join invite by token hash: exists, not revoked, not
 * expired, under max_uses. Returns null for all failure modes alike — callers
 * must not let clients distinguish them (no enumeration oracle).
 */
export async function findValidTeamInviteByHash(
  db: Database,
  tokenHash: string,
  now: string,
): Promise<TeamInviteRecord | null> {
  const rows = await db.select().from(teamInvites).where(eq(teamInvites.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt <= now) return null;
  if (row.maxUses !== null && row.useCount >= row.maxUses) return null;
  return inviteToDomain(row);
}

/** Count a successful join. Atomic increment — acceptances can race. */
export async function incrementTeamInviteUse(db: Database, id: string): Promise<void> {
  await db
    .update(teamInvites)
    .set({ useCount: sql`${teamInvites.useCount} + 1` })
    .where(eq(teamInvites.id, id));
}

export async function listTeamInvites(db: Database, teamId: string): Promise<TeamInviteRecord[]> {
  const rows = await db.select().from(teamInvites).where(eq(teamInvites.teamId, teamId)).orderBy(teamInvites.createdAt);
  return rows.map(inviteToDomain);
}

export async function revokeTeamInvite(db: Database, id: string, now: string): Promise<void> {
  await db.update(teamInvites).set({ revokedAt: now }).where(eq(teamInvites.id, id));
}
