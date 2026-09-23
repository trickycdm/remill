/**
 * Document-trash queries (D29). Deleting a document is a SNAPSHOT-then-delete
 * batch: the doc (+ its newest revisions) is copied into `document_trash`, then
 * the original row is hard-deleted so FK cascades clear index/revisions/grants
 * and the FTS row is removed explicitly — no read path ever needs a
 * `deleted_at` guard. Restore re-inserts under the ORIGINAL document id.
 *
 * Grant witnesses: trash rows carry content (data_json), so reads/mutations
 * demand a Grant like any document query. The one exception is
 * `purgeExpiredTrashRows` — retention is maintenance, not an authorization
 * decision (ACCESS_CONTROL.md, witness-free maintenance)  — and the two
 * metadata-only helpers (`getTrashMeta`, `trashedCollections`), which follow
 * the getDocumentMetaForAuth precedent: never any content.
 */

import { and, or, eq, lt, sql, desc, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '@/db/client';
import { documents, documentTrash, documentRevisions, documentIndex } from '@/db/schema';
import { documentFts } from '@/db/fts-table';
import { eventInsert, type EventInput } from '@/db/queries/events';
import { newId } from '@/lib/id';
import type { Grant } from '@/access/grant';
import type { IndexValue, SearchText, Visibility } from '@/db/queries/documents';

type Batch = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

/** One snapshotted revision inside `revisions_json` (newest first, capped). */
export interface TrashRevision {
  readonly revision: number;
  readonly data: Record<string, unknown>;
  readonly savedBy: string | null;
  readonly savedAt: string;
}

export interface TrashRecord {
  readonly id: string;
  readonly documentId: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly revisions: readonly TrashRevision[];
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly visibility: Visibility;
  readonly deletedBy: string | null;
  readonly deletedAt: string;
}

type Row = typeof documentTrash.$inferSelect;

function toDomain(row: Row): TrashRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    collection: row.collection,
    data: JSON.parse(row.dataJson || '{}'),
    status: row.status as 'draft' | 'published',
    revisions: JSON.parse(row.revisionsJson || '[]'),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    visibility: row.visibility as Visibility,
    deletedBy: row.deletedBy,
    deletedAt: row.deletedAt,
  };
}

export interface TrashInput {
  readonly documentId: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly revisions: readonly TrashRevision[];
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly visibility: Visibility;
  readonly deletedBy: string;
  readonly deletedAt: string;
  /** Outbox event (D33) committed atomically with the trashing. */
  readonly event?: EventInput;
}

/** Snapshot a document into trash + hard-delete the original, atomically.
 *  Index/revisions/item-grants cascade off the document delete; the FTS row is
 *  removed explicitly (virtual tables have no FK). Witness required. */
export async function trashDocument(db: Database, input: TrashInput, _grant: Grant): Promise<string> {
  const trashId = newId('trash');
  const stmts: Batch = [
    db.insert(documentTrash).values({
      id: trashId,
      documentId: input.documentId,
      collection: input.collection,
      dataJson: JSON.stringify(input.data),
      status: input.status,
      revisionsJson: JSON.stringify(input.revisions),
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      publishedAt: input.publishedAt,
      visibility: input.visibility,
      deletedBy: input.deletedBy,
      deletedAt: input.deletedAt,
    }),
    db.delete(documents).where(eq(documents.id, input.documentId)),
    db.delete(documentFts).where(eq(documentFts.documentId, input.documentId)),
  ];
  if (input.event) stmts.push(eventInsert(db, input.event));
  await db.batch(stmts);
  return trashId;
}

/** Collection + original id for a trash row — metadata only, NO witness (the
 *  service needs the collection BEFORE it can authorize; content stays gated). */
export async function getTrashMeta(
  db: Database,
  trashId: string,
): Promise<{ collection: string; documentId: string } | null> {
  const rows = await db
    .select({ collection: documentTrash.collection, documentId: documentTrash.documentId })
    .from(documentTrash)
    .where(eq(documentTrash.id, trashId))
    .limit(1);
  return rows[0] ?? null;
}

/** Distinct collections currently holding trash rows — slugs only, NO witness. */
export async function trashedCollections(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ collection: documentTrash.collection })
    .from(documentTrash);
  return rows.map((r) => r.collection);
}

/** Read one full trash row. Witness required (content). */
export async function getTrashRecord(
  db: Database,
  trashId: string,
  _grant: Grant,
): Promise<TrashRecord | null> {
  const rows = await db.select().from(documentTrash).where(eq(documentTrash.id, trashId)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** One collection's slice of a trash listing. `conditions` mirrors the caller's
 *  delete-permission conditions (ACCESS_CONTROL's closed enum): undefined =
 *  unconditional; else the OR of `ownBy` (snapshot creator) / `publishedOnly` —
 *  compiled IN-QUERY, never post-filtered (D17). */
export interface TrashScope {
  readonly collection: string;
  readonly conditions?: { readonly ownBy?: string; readonly publishedOnly?: boolean };
}

/** List trash rows across the caller's scopes, newest deletions first. One
 *  Grant per scope — the service delete-authorized each collection. */
export async function listTrash(
  db: Database,
  opts: { readonly scopes: readonly TrashScope[]; readonly limit: number; readonly offset: number },
  _grants: readonly Grant[],
): Promise<TrashRecord[]> {
  if (!opts.scopes.length) return [];
  const preds = opts.scopes.map((s) => {
    const base = eq(documentTrash.collection, s.collection);
    if (!s.conditions) return base;
    const alts: SQL[] = [];
    if (s.conditions.ownBy) alts.push(eq(documentTrash.createdBy, s.conditions.ownBy));
    if (s.conditions.publishedOnly) alts.push(eq(documentTrash.status, 'published'));
    // A conditioned scope with no resolvable alternative matches nothing.
    return alts.length ? and(base, or(...alts))! : sql`1 = 0`;
  });
  const rows = await db
    .select()
    .from(documentTrash)
    .where(or(...preds))
    .orderBy(desc(documentTrash.deletedAt), desc(documentTrash.id))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map(toDomain);
}

export interface RestoreInput {
  readonly trashId: string;
  readonly documentId: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly revisions: readonly TrashRevision[];
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string; // set to `now` by the service
  readonly publishedAt: string | null;
  readonly visibility: Visibility;
  readonly index: IndexValue[];
  readonly search: SearchText | null;
  /** Outbox event (D33) committed atomically with the restore. */
  readonly event?: EventInput;
}

/** Re-insert a trashed document under its ORIGINAL id (+ index, FTS, snapshotted
 *  revisions) and drop the trash row, atomically. Unique/PK violations bubble to
 *  the service (409 — id re-created or a unique value re-taken meanwhile).
 *  Witness required. */
export async function restoreTrashedDocument(
  db: Database,
  input: RestoreInput,
  _grant: Grant,
): Promise<void> {
  const stmts: BatchItem<'sqlite'>[] = [
    db.insert(documents).values({
      id: input.documentId,
      collection: input.collection,
      dataJson: JSON.stringify(input.data),
      status: input.status,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      publishedAt: input.publishedAt,
      visibility: input.visibility,
    }),
    ...input.index.map((v) =>
      db.insert(documentIndex).values({
        id: newId('index'),
        documentId: input.documentId,
        collection: input.collection,
        fieldKey: v.fieldKey,
        valueText: v.valueText,
        valueNum: v.valueNum,
        uniqueKey: v.uniqueKey,
      }),
    ),
    ...input.revisions.map((r) =>
      db.insert(documentRevisions).values({
        id: newId('revision'),
        documentId: input.documentId,
        revision: r.revision,
        dataJson: JSON.stringify(r.data),
        savedBy: r.savedBy,
        savedAt: r.savedAt,
      }),
    ),
    db.delete(documentTrash).where(eq(documentTrash.id, input.trashId)),
  ];
  if (input.search && (input.search.title || input.search.body)) {
    stmts.push(
      db.insert(documentFts).values({
        documentId: input.documentId,
        collection: input.collection,
        title: input.search.title ?? '',
        body: input.search.body,
      }),
    );
  }
  if (input.event) stmts.push(eventInsert(db, input.event));
  await db.batch(stmts as Batch);
}

/** Permanently delete one trash row ("delete forever"). Witness required. */
export async function deleteTrashRow(db: Database, trashId: string, _grant: Grant): Promise<void> {
  await db.delete(documentTrash).where(eq(documentTrash.id, trashId));
}

/** Retention purge: drop rows deleted before `cutoff`. WITNESS-FREE by design —
 *  maintenance, not an authorization decision (runs from cron with no principal;
 *  ACCESS_CONTROL.md documents the exception). Returns rows removed. */
export async function purgeExpiredTrashRows(db: Database, cutoff: string): Promise<number> {
  const expired: SQL = lt(documentTrash.deletedAt, cutoff);
  const rows = await db.select({ id: documentTrash.id }).from(documentTrash).where(expired);
  if (!rows.length) return 0;
  await db.delete(documentTrash).where(expired);
  return rows.length;
}
