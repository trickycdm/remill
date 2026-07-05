/**
 * Item-grant queries — per-document permission tuples (steering/ACCESS_CONTROL.md).
 * A grant targets a `principal` or a `role`; the decision function matches it
 * against the acting principal's id and role set, and honors `expires_at`.
 */

import { and, eq, inArray, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { itemGrants } from '@/db/schema';
import { newId } from '@/lib/id';
import type { Action } from '@/access/types';

export interface ItemGrantRecord {
  readonly id: string;
  readonly subjectKind: 'principal' | 'role';
  readonly subjectId: string;
  readonly documentId: string;
  readonly actions: Action[];
  readonly grantedBy: string;
  readonly expiresAt: string | null;
}

function toDomain(r: typeof itemGrants.$inferSelect): ItemGrantRecord {
  return {
    id: r.id,
    subjectKind: r.subjectKind as 'principal' | 'role',
    subjectId: r.subjectId,
    documentId: r.documentId,
    actions: JSON.parse(r.actionsJson || '[]') as Action[],
    grantedBy: r.grantedBy,
    expiresAt: r.expiresAt,
  };
}

/** All non-expired grants on a document that apply to a principal or its roles. */
export async function getApplicableGrants(
  db: Database,
  documentId: string,
  principalId: string,
  roleSlugs: string[],
  now: string,
): Promise<ItemGrantRecord[]> {
  const subjectMatch = or(
    and(eq(itemGrants.subjectKind, 'principal'), eq(itemGrants.subjectId, principalId)),
    roleSlugs.length
      ? and(eq(itemGrants.subjectKind, 'role'), inArray(itemGrants.subjectId, roleSlugs))
      : undefined,
  );
  const rows = await db
    .select()
    .from(itemGrants)
    .where(
      and(
        eq(itemGrants.documentId, documentId),
        subjectMatch,
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
): Promise<{ documentId: string; actions: Action[] }[]> {
  const subjectMatch = or(
    and(eq(itemGrants.subjectKind, 'principal'), eq(itemGrants.subjectId, principalId)),
    roleSlugs.length
      ? and(eq(itemGrants.subjectKind, 'role'), inArray(itemGrants.subjectId, roleSlugs))
      : undefined,
  );
  const rows = await db
    .select({ documentId: itemGrants.documentId, actionsJson: itemGrants.actionsJson })
    .from(itemGrants)
    .where(and(subjectMatch, or(isNull(itemGrants.expiresAt), gt(itemGrants.expiresAt, now))));
  return rows.map((r) => ({ documentId: r.documentId, actions: JSON.parse(r.actionsJson || '[]') as Action[] }));
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
