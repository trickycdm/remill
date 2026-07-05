/**
 * Document queries — the core write path. Every function that reads or mutates a
 * document REQUIRES a `Grant` witness parameter (steering/ACCESS_CONTROL.md,
 * D17): a service that skips authorize() cannot obtain a Grant and so cannot call
 * these — a compile error, not a convention.
 *
 * The save is ONE atomic `db.batch()` carrying the document upsert, the
 * document_index sync (delete-then-insert), and the revision append — so the
 * document, its index, and its history never drift apart (DATABASE_STANDARDS.md).
 */

import { and, eq, sql, desc, count, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '@/db/client';
import { documents, documentIndex, documentRevisions } from '@/db/schema';
import { newId } from '@/lib/id';
import type { Grant } from '@/access/grant';

export interface DocumentRecord {
  readonly id: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

/** One document_index row to write (documentId + collection filled by the query). */
export interface IndexValue {
  readonly fieldKey: string;
  readonly valueText: string | null;
  readonly valueNum: number | null;
}

type Row = typeof documents.$inferSelect;

function toDomain(row: Row): DocumentRecord {
  return {
    id: row.id,
    collection: row.collection,
    data: JSON.parse(row.dataJson || '{}'),
    status: row.status as 'draft' | 'published',
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

/**
 * Read a document's authorization-relevant metadata (status, owner) by id. NO
 * witness: this is called BY the access module to resolve `own`/`published`
 * conditions before a decision — it never returns content (data_json). See
 * authorize() in src/access/.
 */
export async function getDocumentMetaForAuth(
  db: Database,
  id: string,
): Promise<{ status: 'draft' | 'published'; createdBy: string | null } | null> {
  const rows = await db
    .select({ status: documents.status, createdBy: documents.createdBy })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  const r = rows[0];
  return r ? { status: r.status as 'draft' | 'published', createdBy: r.createdBy } : null;
}

/** Read one document by id (scoped to a collection). Witness required. */
export async function getDocument(
  db: Database,
  collection: string,
  id: string,
  _grant: Grant,
): Promise<DocumentRecord | null> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.collection, collection), eq(documents.id, id)))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export interface ListFilter {
  readonly fieldKey: string;
  readonly value: string;
}

export interface ListSort {
  readonly fieldKey: string;
  readonly dir: 'asc' | 'desc';
}

export interface ListOptions {
  readonly limit: number;
  readonly offset: number;
  /** Access predicate compiled from the principal's permissions (applied INSIDE
   *  the query — never post-filter). undefined = no restriction (admin). */
  readonly accessFilter?: SQL;
  /** Optional status narrowing (e.g. published-only for anonymous). */
  readonly status?: 'draft' | 'published';
  /** Exact-match filters on indexed fields (via document_index). */
  readonly filters?: readonly ListFilter[];
  /** Sort by an indexed field (via document_index), else by createdAt desc. */
  readonly sort?: ListSort;
}

/** Predicate: documents whose indexed `fieldKey` equals `value` (in this collection). */
function indexFilter(collection: string, f: ListFilter): SQL {
  return sql`${documents.id} IN (SELECT ${documentIndex.documentId} FROM ${documentIndex} WHERE ${documentIndex.collection} = ${collection} AND ${documentIndex.fieldKey} = ${f.fieldKey} AND ${documentIndex.valueText} = ${f.value})`;
}

/** List documents in a collection with the access predicate applied in-query.
 *  Returns rows for the page plus the total matching the SAME filter (so counts
 *  and pagination can never leak — D17). Witness required. */
export async function listDocuments(
  db: Database,
  collection: string,
  opts: ListOptions,
  _grant: Grant,
): Promise<{ rows: DocumentRecord[]; total: number }> {
  const where = and(
    eq(documents.collection, collection),
    opts.status ? eq(documents.status, opts.status) : undefined,
    opts.accessFilter,
    ...(opts.filters ?? []).map((f) => indexFilter(collection, f)),
  );
  // Sort by an indexed field via a correlated subquery, else newest-first.
  const orderBy = opts.sort
    ? sql`(SELECT ${documentIndex.valueText} FROM ${documentIndex} WHERE ${documentIndex.documentId} = ${documents.id} AND ${documentIndex.fieldKey} = ${opts.sort.fieldKey}) ${opts.sort.dir === 'asc' ? sql`ASC` : sql`DESC`}`
    : sql`${documents.createdAt} DESC, ${documents.id} DESC`;
  const rows = await db
    .select()
    .from(documents)
    .where(where)
    .orderBy(orderBy)
    .limit(opts.limit)
    .offset(opts.offset);
  const totalRows = await db.select({ n: count() }).from(documents).where(where);
  return { rows: rows.map(toDomain), total: totalRows[0]?.n ?? 0 };
}

/** The next 1-based revision number for a document. */
export async function nextRevisionNumber(db: Database, documentId: string): Promise<number> {
  const rows = await db
    .select({ max: sql<number>`COALESCE(MAX(${documentRevisions.revision}), 0)` })
    .from(documentRevisions)
    .where(eq(documentRevisions.documentId, documentId));
  return (rows[0]?.max ?? 0) + 1;
}

/** Whether a value already exists for an indexed+unique field (excluding one id).
 *  Used by the documents service to enforce `unique` before writing. */
export async function isIndexValueTaken(
  db: Database,
  collection: string,
  fieldKey: string,
  valueText: string,
  excludeDocumentId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: documentIndex.documentId })
    .from(documentIndex)
    .where(
      and(
        eq(documentIndex.collection, collection),
        eq(documentIndex.fieldKey, fieldKey),
        eq(documentIndex.valueText, valueText),
        excludeDocumentId ? sql`${documentIndex.documentId} <> ${excludeDocumentId}` : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

type Batch = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

function indexInserts(db: Database, documentId: string, collection: string, values: IndexValue[]) {
  return values.map((v) =>
    db.insert(documentIndex).values({
      id: newId('index'),
      documentId,
      collection,
      fieldKey: v.fieldKey,
      valueText: v.valueText,
      valueNum: v.valueNum,
    }),
  );
}

export interface InsertInput {
  readonly id: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly createdBy: string;
  readonly now: string;
  readonly publishedAt: string | null;
  readonly index: IndexValue[];
}

/** Create a document + its index rows + revision 1, atomically. Witness required. */
export async function insertDocument(
  db: Database,
  input: InsertInput,
  _grant: Grant,
): Promise<void> {
  const stmts: BatchItem<'sqlite'>[] = [
    db.insert(documents).values({
      id: input.id,
      collection: input.collection,
      dataJson: JSON.stringify(input.data),
      status: input.status,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
      publishedAt: input.publishedAt,
    }),
    ...indexInserts(db, input.id, input.collection, input.index),
    db.insert(documentRevisions).values({
      id: newId('revision'),
      documentId: input.id,
      revision: 1,
      dataJson: JSON.stringify(input.data),
      savedBy: input.createdBy,
      savedAt: input.now,
    }),
  ];
  await db.batch(stmts as Batch);
}

export interface UpdateInput {
  readonly id: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly savedBy: string;
  readonly now: string;
  readonly publishedAt: string | null;
  readonly revision: number;
  readonly index: IndexValue[];
}

/** Update a document: replace data, re-sync index (delete-then-insert), append a
 *  revision — all in one atomic batch. Witness required. */
export async function updateDocument(
  db: Database,
  input: UpdateInput,
  _grant: Grant,
): Promise<void> {
  const stmts: BatchItem<'sqlite'>[] = [
    db
      .update(documents)
      .set({
        dataJson: JSON.stringify(input.data),
        status: input.status,
        updatedAt: input.now,
        publishedAt: input.publishedAt,
      })
      .where(eq(documents.id, input.id)),
    db.delete(documentIndex).where(eq(documentIndex.documentId, input.id)),
    ...indexInserts(db, input.id, input.collection, input.index),
    db.insert(documentRevisions).values({
      id: newId('revision'),
      documentId: input.id,
      revision: input.revision,
      dataJson: JSON.stringify(input.data),
      savedBy: input.savedBy,
      savedAt: input.now,
    }),
  ];
  await db.batch(stmts as Batch);
}

/** Delete a document (index + revisions cascade via FK). Witness required. */
export async function deleteDocument(
  db: Database,
  id: string,
  _grant: Grant,
): Promise<void> {
  await db.delete(documents).where(eq(documents.id, id));
}

/** Revision history for a document, newest first. Witness required. */
export async function listRevisions(
  db: Database,
  documentId: string,
  _grant: Grant,
) {
  const rows = await db
    .select()
    .from(documentRevisions)
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.revision));
  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    data: JSON.parse(r.dataJson || '{}') as Record<string, unknown>,
    savedBy: r.savedBy,
    savedAt: r.savedAt,
  }));
}
