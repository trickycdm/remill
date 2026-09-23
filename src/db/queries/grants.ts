/**
 * Item-grant queries — per-document permission tuples (steering/ACCESS_CONTROL.md).
 * A grant targets a `principal`, a `role`, or a `link` (C3: the hashed share-link
 * token as subjectId); the decision function matches it against the acting
 * principal's id, role set, and carried link identity, and honors `expires_at`.
 */

import { and, eq, inArray, gt, isNull, ne, or } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { itemGrants } from '@/db/schema';
import { newId } from '@/lib/id';
import type { Action } from '@/access/types';

export type GrantSubjectKind = 'principal' | 'role' | 'link' | 'team';

export interface ItemGrantRecord {
  readonly id: string;
  readonly subjectKind: GrantSubjectKind;
  readonly subjectId: string;
  readonly documentId: string;
  readonly actions: Action[];
  readonly grantedBy: string;
  readonly expiresAt: string | null;
  /** Optional human label (share links, D51). */
  readonly label: string | null;
  /** Whether a link grant is password-protected (D51). The hash itself NEVER
   *  leaves the query layer — see getLinkGrantPasswordHash. */
  readonly hasPassword: boolean;
}

/** Internal shape used only by the link-listing path that needs to re-decrypt
 *  the token for re-display (D53) — `tokenEnc` never rides on the public
 *  `ItemGrantRecord`, mirroring how `passwordHash` stays query-layer-only. */
export interface ItemGrantRecordWithTokenEnc extends ItemGrantRecord {
  /** AES-GCM ciphertext of the plaintext token, or null for a link minted
   *  before this column existed. */
  readonly tokenEnc: string | null;
}

function toDomain(r: typeof itemGrants.$inferSelect): ItemGrantRecord {
  return {
    id: r.id,
    subjectKind: r.subjectKind as GrantSubjectKind,
    subjectId: r.subjectId,
    documentId: r.documentId,
    actions: JSON.parse(r.actionsJson || '[]') as Action[],
    grantedBy: r.grantedBy,
    expiresAt: r.expiresAt,
    label: r.label,
    hasPassword: r.passwordHash != null,
  };
}

function toDomainWithTokenEnc(r: typeof itemGrants.$inferSelect): ItemGrantRecordWithTokenEnc {
  return { ...toDomain(r), tokenEnc: r.tokenEnc };
}

/** The subject-match predicate: the principal itself, any of its roles, any of
 *  its teams (D24), and — when the request arrived through a share link — that
 *  link's hashed identity. `link` and `team` are EXPLICIT branches (never
 *  disguised as principal ids) so the access matrix and audit stay honest
 *  about who was granted what. */
function subjectMatchFor(principalId: string, roleSlugs: string[], linkId?: string, teamIds?: string[]) {
  return or(
    and(eq(itemGrants.subjectKind, 'principal'), eq(itemGrants.subjectId, principalId)),
    roleSlugs.length
      ? and(eq(itemGrants.subjectKind, 'role'), inArray(itemGrants.subjectId, roleSlugs))
      : undefined,
    linkId ? and(eq(itemGrants.subjectKind, 'link'), eq(itemGrants.subjectId, linkId)) : undefined,
    teamIds?.length
      ? and(eq(itemGrants.subjectKind, 'team'), inArray(itemGrants.subjectId, teamIds))
      : undefined,
  );
}

/** All non-expired grants on a document that apply to a principal, its roles,
 *  its teams, or its carried link identity. */
export async function getApplicableGrants(
  db: Database,
  documentId: string,
  principalId: string,
  roleSlugs: string[],
  now: string,
  linkId?: string,
  teamIds?: string[],
): Promise<ItemGrantRecord[]> {
  const rows = await db
    .select()
    .from(itemGrants)
    .where(
      and(
        eq(itemGrants.documentId, documentId),
        subjectMatchFor(principalId, roleSlugs, linkId, teamIds),
        or(isNull(itemGrants.expiresAt), gt(itemGrants.expiresAt, now)),
      ),
    );
  return rows.map(toDomain);
}

/** Document ids in a collection the principal has an unexpired grant for `action`
 *  on — used to widen the compiled list filter (`id IN (…)`). */
export async function getGrantedDocumentIds(
  db: Database,
  principalId: string,
  roleSlugs: string[],
  now: string,
  linkId?: string,
  teamIds?: string[],
): Promise<{ documentId: string; actions: Action[]; expiresAt: string | null }[]> {
  const rows = await db
    .select({ documentId: itemGrants.documentId, actionsJson: itemGrants.actionsJson, expiresAt: itemGrants.expiresAt })
    .from(itemGrants)
    .where(
      and(subjectMatchFor(principalId, roleSlugs, linkId, teamIds), or(isNull(itemGrants.expiresAt), gt(itemGrants.expiresAt, now))),
    );
  return rows.map((r) => ({
    documentId: r.documentId,
    actions: JSON.parse(r.actionsJson || '[]') as Action[],
    expiresAt: r.expiresAt,
  }));
}

/** Resolve an unexpired link grant by the hashed share token. Returns null for
 *  unknown, expired, and revoked alike — no enumeration oracle (the token IS the
 *  credential; invite-token precedent). */
export async function findLinkGrantByHash(
  db: Database,
  tokenHash: string,
  now: string,
): Promise<ItemGrantRecord | null> {
  const rows = await db
    .select()
    .from(itemGrants)
    .where(
      and(
        eq(itemGrants.subjectKind, 'link'),
        eq(itemGrants.subjectId, tokenHash),
        or(isNull(itemGrants.expiresAt), gt(itemGrants.expiresAt, now)),
      ),
    )
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Resolve an unexpired link grant by the hashed share token TOGETHER with its
 *  stored password hash — one query instead of `findLinkGrantByHash` +
 *  `getLinkGrantPasswordHash`. `openShareLink` and
 *  `unlockShareLink` both use this so a link marked `hasPassword` with no
 *  retrievable hash is visible to both as the SAME row — neither can
 *  independently drift into "fail open" when the other stays closed. */
export async function findLinkGrantWithHashByTokenHash(
  db: Database,
  tokenHash: string,
  now: string,
): Promise<{ grant: ItemGrantRecord; passwordHash: string | null } | null> {
  const rows = await db
    .select()
    .from(itemGrants)
    .where(
      and(
        eq(itemGrants.subjectKind, 'link'),
        eq(itemGrants.subjectId, tokenHash),
        or(isNull(itemGrants.expiresAt), gt(itemGrants.expiresAt, now)),
      ),
    )
    .limit(1);
  const r = rows[0];
  return r ? { grant: toDomain(r), passwordHash: r.passwordHash } : null;
}

/** Every item grant in the install (newest first) — for the access overview. */
export async function listAllGrants(db: Database): Promise<ItemGrantRecord[]> {
  const rows = await db.select().from(itemGrants).orderBy(itemGrants.createdAt);
  return rows.map(toDomain);
}

/** All grants on a document (any subject), newest first — for the Share surface. */
export async function listGrantsForDocument(db: Database, documentId: string): Promise<ItemGrantRecord[]> {
  const rows = await db
    .select()
    .from(itemGrants)
    .where(eq(itemGrants.documentId, documentId))
    .orderBy(itemGrants.createdAt);
  return rows.map(toDomain);
}

/** Non-link grants on a document (the "People & roles" section of the Share
 *  panel — share LINKS get their own list below). Filters `subjectKind` in
 *  SQL rather than post-filtering an unbounded row set in memory. */
export async function listNonLinkGrantsForDocument(db: Database, documentId: string): Promise<ItemGrantRecord[]> {
  const rows = await db
    .select()
    .from(itemGrants)
    .where(and(eq(itemGrants.documentId, documentId), ne(itemGrants.subjectKind, 'link')))
    .orderBy(itemGrants.createdAt);
  return rows.map(toDomain);
}

/** Unexpired share-link grants on a document, newest first (the Share panel's
 *  "Share links" section — an expired link is dead weight, not something to
 *  still list and let someone try to revoke twice). */
export async function listLinkGrantsForDocument(
  db: Database,
  documentId: string,
  now: string,
): Promise<ItemGrantRecordWithTokenEnc[]> {
  const rows = await db
    .select()
    .from(itemGrants)
    .where(
      and(
        eq(itemGrants.documentId, documentId),
        eq(itemGrants.subjectKind, 'link'),
        or(isNull(itemGrants.expiresAt), gt(itemGrants.expiresAt, now)),
      ),
    )
    .orderBy(itemGrants.createdAt);
  return rows.map(toDomainWithTokenEnc);
}

/** Input to createItemGrant. Deliberately NOT `Omit<ItemGrantRecord, 'id'>`: the
 *  record exposes `hasPassword` (derived), never the hash — the write side takes
 *  the hash directly instead. */
export interface CreateItemGrantInput {
  readonly subjectKind: GrantSubjectKind;
  readonly subjectId: string;
  readonly documentId: string;
  readonly actions: Action[];
  readonly grantedBy: string;
  readonly expiresAt: string | null;
  /** Share links only (D51); scrypt hash, never plaintext. */
  readonly passwordHash?: string | null;
  readonly label?: string | null;
  /** Share links only (D53); AES-GCM ciphertext of the plaintext token, for
   *  re-display — see ItemGrantRecordWithTokenEnc. */
  readonly tokenEnc?: string | null;
}

export async function createItemGrant(
  db: Database,
  grant: CreateItemGrantInput,
  now: string,
): Promise<string> {
  const id = newId('grant');
  await db.insert(itemGrants).values({
    id,
    subjectKind: grant.subjectKind,
    subjectId: grant.subjectId,
    documentId: grant.documentId,
    actionsJson: JSON.stringify(grant.actions),
    grantedBy: grant.grantedBy,
    expiresAt: grant.expiresAt,
    passwordHash: grant.passwordHash ?? null,
    label: grant.label ?? null,
    tokenEnc: grant.tokenEnc ?? null,
    createdAt: now,
  });
  return id;
}

/** The stored password hash for a link grant — internal, used only by the
 *  unlock check (D51). NEVER surfaced on ItemGrantRecord. Null for unknown
 *  grants and grants with no password alike (no enumeration oracle). */
export async function getLinkGrantPasswordHash(db: Database, grantId: string): Promise<string | null> {
  const rows = await db
    .select({ passwordHash: itemGrants.passwordHash })
    .from(itemGrants)
    .where(eq(itemGrants.id, grantId))
    .limit(1);
  return rows[0]?.passwordHash ?? null;
}

export async function revokeItemGrant(db: Database, id: string): Promise<void> {
  await db.delete(itemGrants).where(eq(itemGrants.id, id));
}

/** Revoke every grant held by one subject — e.g. all of a deleted team's grants
 *  (kind-polymorphic subject_id has no FK, so nothing cascades these). */
export async function revokeGrantsForSubject(db: Database, subjectKind: GrantSubjectKind, subjectId: string): Promise<void> {
  await db.delete(itemGrants).where(and(eq(itemGrants.subjectKind, subjectKind), eq(itemGrants.subjectId, subjectId)));
}
