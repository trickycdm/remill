/**
 * Item-grant queries — per-document permission tuples (steering/ACCESS_CONTROL.md).
 * A grant targets a `principal`, a `role`, or a `link` (C3: the hashed share-link
 * token as subjectId); the decision function matches it against the acting
 * principal's id, role set, and carried link identity, and honors `expires_at`.
 */

import { and, eq, inArray, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { itemGrants } from '@/db/schema';
import { newId } from '@/lib/id';
import type { Action } from '@/access/types';

export type GrantSubjectKind = 'principal' | 'role' | 'link';

export interface ItemGrantRecord {
  readonly id: string;
  readonly subjectKind: GrantSubjectKind;
  readonly subjectId: string;
  readonly documentId: string;
  readonly actions: Action[];
  readonly grantedBy: string;
  readonly expiresAt: string | null;
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
  };
}

/** The subject-match predicate: the principal itself, any of its roles, and —
 *  when the request arrived through a share link — that link's hashed identity.
 *  `link` is an EXPLICIT branch (never disguised as a principal id) so the
 *  access matrix and audit stay honest about who was granted what. */
function subjectMatchFor(principalId: string, roleSlugs: string[], linkId?: string) {
  return or(
    and(eq(itemGrants.subjectKind, 'principal'), eq(itemGrants.subjectId, principalId)),
    roleSlugs.length
      ? and(eq(itemGrants.subjectKind, 'role'), inArray(itemGrants.subjectId, roleSlugs))
      : undefined,
    linkId ? and(eq(itemGrants.subjectKind, 'link'), eq(itemGrants.subjectId, linkId)) : undefined,
  );
}

/** All non-expired grants on a document that apply to a principal, its roles, or
 *  its carried link identity. */
export async function getApplicableGrants(
  db: Database,
  documentId: string,
  principalId: string,
  roleSlugs: string[],
  now: string,
  linkId?: string,
): Promise<ItemGrantRecord[]> {
  const rows = await db
    .select()
    .from(itemGrants)
    .where(
      and(
        eq(itemGrants.documentId, documentId),
        subjectMatchFor(principalId, roleSlugs, linkId),
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
): Promise<{ documentId: string; actions: Action[] }[]> {
  const rows = await db
    .select({ documentId: itemGrants.documentId, actionsJson: itemGrants.actionsJson })
    .from(itemGrants)
    .where(and(subjectMatchFor(principalId, roleSlugs, linkId), or(isNull(itemGrants.expiresAt), gt(itemGrants.expiresAt, now))));
  return rows.map((r) => ({ documentId: r.documentId, actions: JSON.parse(r.actionsJson || '[]') as Action[] }));
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

export async function createItemGrant(
  db: Database,
  grant: Omit<ItemGrantRecord, 'id'>,
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
    createdAt: now,
  });
  return id;
}

export async function revokeItemGrant(db: Database, id: string): Promise<void> {
  await db.delete(itemGrants).where(eq(itemGrants.id, id));
}
