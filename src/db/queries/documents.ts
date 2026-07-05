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

import { and, eq, sql, desc, count, inArray, type SQL } from 'drizzle-orm';
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

/** Which document_index column a field's values live in: number/boolean field
 *  types index into `value_num`, everything else into `value_text`. Threaded from
 *  the service (which knows the field type) so filter/sort target the right column
 *  (COR-3). */
export type IndexKind = 'num' | 'text';

/** One document_index row to write (documentId + collection filled by the query). */
export interface IndexValue {
  readonly fieldKey: string;
  readonly valueText: string | null;
  readonly valueNum: number | null;
  /** `${collection}:${fieldKey}` for fields declared `unique`, else null — the
   *  DB-level uniqueness backing (COR-8). See document_index in schema.ts. */
  readonly uniqueKey: string | null;
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

/**
 * Read a singleton collection's stored `data` (the first/only document), parsed,
 * or null when the singleton has never been saved. NO witness: site configuration
 * (the `settings` singleton) is a rendering concern read on many requests without a
 * principal — the same un-gated posture `getCollection` takes for collection
 * metadata. It exposes ONLY the settings singleton's data via the settings service;
 * never widen this into a general content read (those keep the Grant witness).
 */
export async function getSingletonData(
  db: Database,
  collection: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ dataJson: documents.dataJson })
    .from(documents)
    .where(eq(documents.collection, collection))
    .orderBy(documents.createdAt, documents.id)
    .limit(1);
  const r = rows[0];
  return r ? (JSON.parse(r.dataJson || '{}') as Record<string, unknown>) : null;
}

/** The collection a document lives in, by id — metadata only, NO witness (the
 *  share-link route needs the collection to route the gated read; content never
 *  flows through here — getDocumentMetaForAuth precedent). */
export async function getDocumentCollection(db: Database, id: string): Promise<string | null> {
  const rows = await db
    .select({ collection: documents.collection })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return rows[0]?.collection ?? null;
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
  readonly kind: IndexKind;
  /** Raw filter value; coerced to a number by the query when `kind === 'num'`. */
  readonly value: string;
}

export interface ListSort {
  readonly fieldKey: string;
  readonly kind: IndexKind;
  readonly dir: 'asc' | 'desc';
}

/** Keyset position for cursor pagination on the DEFAULT sort (createdAt, id). */
export interface ListCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface ListOptions {
  readonly limit: number;
  /** Keyset cursor on (createdAt, id) — the performant list path
   *  (DATABASE_STANDARDS §Query performance). When set (and no custom `sort`), the
   *  page is fetched by keyset instead of scanning with OFFSET. */
  readonly cursor?: ListCursor;
  /** Legacy 0-based offset for page-number navigation. Retained for the page-based
   *  callers (admin/REST/MCP); prefer `cursor`. Ignored when `cursor` applies. */
  readonly offset?: number;
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

/** Predicate: documents whose indexed `fieldKey` equals `value` (in this collection).
 *  number/boolean fields (kind 'num') compare `value_num` (text is NULL for them),
 *  everything else compares `value_text` (COR-3). */
function indexFilter(collection: string, f: ListFilter): SQL {
  const col = f.kind === 'num' ? documentIndex.valueNum : documentIndex.valueText;
  const val: string | number = f.kind === 'num' ? Number(f.value) : f.value;
  return sql`${documents.id} IN (SELECT ${documentIndex.documentId} FROM ${documentIndex} WHERE ${documentIndex.collection} = ${collection} AND ${documentIndex.fieldKey} = ${f.fieldKey} AND ${col} = ${val})`;
}

/** Keyset predicate for the default order (createdAt DESC, id DESC): rows strictly
 *  "after" the cursor. */
function cursorPredicate(c: ListCursor): SQL {
  return sql`(${documents.createdAt} < ${c.createdAt} OR (${documents.createdAt} = ${c.createdAt} AND ${documents.id} < ${c.id}))`;
}

/** List documents in a collection with the access predicate applied in-query.
 *  Returns rows for the page plus the total matching the SAME filter — the count
 *  excludes the pagination cursor so it always reflects the full filtered set (so
 *  counts and pagination can never leak — D17). Witness required. */
export async function listDocuments(
  db: Database,
  collection: string,
  opts: ListOptions,
  _grant: Grant,
): Promise<{ rows: DocumentRecord[]; total: number }> {
  // The full-filter WHERE (no pagination) — used verbatim for the total count.
  const baseWhere = and(
    eq(documents.collection, collection),
    opts.status ? eq(documents.status, opts.status) : undefined,
    opts.accessFilter,
    ...(opts.filters ?? []).map((f) => indexFilter(collection, f)),
  );
  // Keyset only applies to the default order; a custom sort falls back to offset.
  const useCursor = !!opts.cursor && !opts.sort;
  const rowsWhere = useCursor ? and(baseWhere, cursorPredicate(opts.cursor!)) : baseWhere;

  // Sort by an indexed field via a correlated subquery (right column per kind),
  // else newest-first.
  const orderBy = opts.sort
    ? sql`(SELECT ${opts.sort.kind === 'num' ? documentIndex.valueNum : documentIndex.valueText} FROM ${documentIndex} WHERE ${documentIndex.documentId} = ${documents.id} AND ${documentIndex.fieldKey} = ${opts.sort.fieldKey}) ${opts.sort.dir === 'asc' ? sql`ASC` : sql`DESC`}`
    : sql`${documents.createdAt} DESC, ${documents.id} DESC`;

  let q = db.select().from(documents).where(rowsWhere).orderBy(orderBy).limit(opts.limit).$dynamic();
  if (!useCursor && opts.offset) q = q.offset(opts.offset);
  const rows = await q;

  const totalRows = await db.select({ n: count() }).from(documents).where(baseWhere);
  return { rows: rows.map(toDomain), total: totalRows[0]?.n ?? 0 };
}

/** Batch-read documents by id within ONE collection, with the caller's compiled
 *  access predicate applied in-query — ids the reader cannot see simply don't
 *  come back (never post-filter). Used by relation read-expansion (B2). Chunked
 *  to respect D1's per-statement bound-parameter budget. Witness required. */
export async function getDocumentsByIds(
  db: Database,
  collection: string,
  ids: readonly string[],
  accessFilter: SQL | undefined,
  _grant: Grant,
): Promise<DocumentRecord[]> {
  const CHUNK = 80;
  const out: DocumentRecord[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.collection, collection),
          inArray(documents.id, [...ids.slice(i, i + CHUNK)]),
          accessFilter,
        ),
      );
    out.push(...rows.map(toDomain));
  }
  return out;
}

/** Documents in ONE source collection whose indexed relation field(s) reference
 *  `targetDocId` — the reverse edge lookup (backlinks, B3). This is a CONTENT
 *  read, so the caller's compiled access predicate applies in-query (unlike
 *  `isIndexValueTaken` below, which is an access-blind uniqueness pre-check and
 *  must never serve user-facing reads). Witness required. */
export async function listBacklinks(
  db: Database,
  sourceCollection: string,
  fieldKeys: readonly string[],
  targetDocId: string,
  accessFilter: SQL | undefined,
  limit: number,
  _grant: Grant,
): Promise<DocumentRecord[]> {
  if (!fieldKeys.length) return [];
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.collection, sourceCollection),
        sql`${documents.id} IN (SELECT ${documentIndex.documentId} FROM ${documentIndex} WHERE ${documentIndex.collection} = ${sourceCollection} AND ${inArray(documentIndex.fieldKey, [...fieldKeys])} AND ${documentIndex.valueText} = ${targetDocId})`,
        accessFilter,
      ),
    )
    .orderBy(sql`${documents.createdAt} DESC, ${documents.id} DESC`)
    .limit(limit);
  return rows.map(toDomain);
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
 *  Used by the documents service as a friendly pre-check before writing; the DB
 *  unique index is the race-proof guard (COR-8). Compares the column matching the
 *  field's index kind so numeric uniques are checked correctly. */
export async function isIndexValueTaken(
  db: Database,
  collection: string,
  fieldKey: string,
  value: string | number,
  kind: IndexKind,
  excludeDocumentId?: string,
): Promise<boolean> {
  const valueMatch =
    kind === 'num'
      ? eq(documentIndex.valueNum, Number(value))
      : eq(documentIndex.valueText, String(value));
  const rows = await db
    .select({ id: documentIndex.documentId })
    .from(documentIndex)
    .where(
      and(
        eq(documentIndex.collection, collection),
        eq(documentIndex.fieldKey, fieldKey),
        valueMatch,
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
      uniqueKey: v.uniqueKey,
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
