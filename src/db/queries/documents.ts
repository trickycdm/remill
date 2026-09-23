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

import { and, or, eq, sql, desc, count, inArray, getTableColumns, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '@/db/client';
import { documents, documentIndex, documentRevisions } from '@/db/schema';
import { documentFts } from '@/db/fts-table';
import { eventInsert, type EventInput } from '@/db/queries/events';
import { newId } from '@/lib/id';
import type { Grant } from '@/access/grant';
import { VISIBILITIES, type Visibility } from '@/lib/visibility';

/** Document visibility (D50) — separate from draft/published; the union and
 *  its predicates live in `src/lib/visibility.ts` (the single source), and
 *  are re-exported here so existing queries-layer importers are unaffected.
 *  See steering/ACCESS_CONTROL.md for how each value affects anonymous reads. */
export { VISIBILITIES, type Visibility };

export interface DocumentRecord {
  readonly id: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  /** Pending scheduled-publish time (D32) — set only while status is 'draft';
   *  cleared by the drain, by manual publish, and by cancel. */
  readonly publishAt: string | null;
  readonly visibility: Visibility;
  /** The current revision number (D54) — MAX(document_revisions.revision), 0
   *  before the first save lands. Callers echo it back as `expectedRevision` so a
   *  save based on a stale copy fails instead of overwriting newer work. */
  readonly revision: number;
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

/** Every document read selects the table's columns plus the current revision
 *  (D54). The correlated MAX is a single seek on the (document_id, revision)
 *  unique index. Column names are table-qualified by hand: Drizzle renders
 *  single-table selects unqualified, and a bare "id" inside the subquery would
 *  bind to document_revisions.id instead of the outer documents.id. */
const docColumns = {
  ...getTableColumns(documents),
  revision: sql<number>`(SELECT COALESCE(MAX("document_revisions"."revision"), 0) FROM "document_revisions" WHERE "document_revisions"."document_id" = "documents"."id")`,
};

type Row = typeof documents.$inferSelect & { revision: number };

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
    publishAt: row.publishAt,
    visibility: row.visibility as Visibility,
    revision: Number(row.revision ?? 0),
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
): Promise<{
  collection: string;
  status: 'draft' | 'published';
  createdBy: string | null;
  visibility: Visibility;
} | null> {
  const rows = await db
    .select({
      collection: documents.collection,
      status: documents.status,
      createdBy: documents.createdBy,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  const r = rows[0];
  return r
    ? {
        collection: r.collection,
        status: r.status as 'draft' | 'published',
        createdBy: r.createdBy,
        visibility: r.visibility as Visibility,
      }
    : null;
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

/** Batch variant of getDocumentCollection — `{id → collection}` for a set of
 *  ids. Metadata only, NO witness (content never flows through here); used to
 *  group a principal's granted document ids by collection ("Shared with me"). */
export async function getDocumentCollections(db: Database, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db
      .select({ id: documents.id, collection: documents.collection })
      .from(documents)
      .where(inArray(documents.id, [...ids.slice(i, i + CHUNK)]));
    for (const r of rows) out.set(r.id, r.collection);
  }
  return out;
}

/** Read one document by id (scoped to a collection). Witness required. */
export async function getDocument(
  db: Database,
  collection: string,
  id: string,
  _grant: Grant,
): Promise<DocumentRecord | null> {
  const rows = await db
    .select(docColumns)
    .from(documents)
    .where(and(eq(documents.collection, collection), eq(documents.id, id)))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

/** Filter comparison operators (D28). `eq` is the default; `contains` is a LIKE
 *  substring match on value_text; `in` matches any of a comma-separated set. */
export const FILTER_OPS = ['eq', 'gte', 'lte', 'contains', 'in'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface ListFilter {
  readonly fieldKey: string;
  readonly kind: IndexKind;
  readonly op: FilterOp;
  /** Raw filter value; coerced to a number by the query when `kind === 'num'`.
   *  For `op: 'in'` this is the comma-separated set (validated by the service). */
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

/** Escape LIKE wildcards in a user-supplied substring (used with ESCAPE '\'). */
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Predicate: documents whose indexed `fieldKey` matches the filter (in this
 *  collection). number/boolean fields (kind 'num') compare `value_num` (text is
 *  NULL for them), everything else compares `value_text` (COR-3). Operators
 *  (D28): gte/lte compare on the kind-matched column (ISO datetimes compare
 *  correctly as text); `contains` is a LIKE on value_text (the service rejects
 *  it for numeric kinds); `in` matches any element of the comma-separated set. */
function indexFilter(collection: string, f: ListFilter): SQL {
  const col = f.kind === 'num' ? documentIndex.valueNum : documentIndex.valueText;
  const coerce = (raw: string): string | number => (f.kind === 'num' ? Number(raw) : raw);
  let cmp: SQL;
  switch (f.op) {
    case 'gte':
      cmp = sql`${col} >= ${coerce(f.value)}`;
      break;
    case 'lte':
      cmp = sql`${col} <= ${coerce(f.value)}`;
      break;
    case 'contains':
      cmp = sql`${documentIndex.valueText} LIKE '%' || ${escapeLike(f.value)} || '%' ESCAPE '\\'`;
      break;
    case 'in': {
      const vals = f.value.split(',').map((s) => coerce(s.trim()));
      cmp = sql`${col} IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`;
      break;
    }
    default:
      cmp = sql`${col} = ${coerce(f.value)}`;
  }
  return sql`${documents.id} IN (SELECT ${documentIndex.documentId} FROM ${documentIndex} WHERE ${documentIndex.collection} = ${collection} AND ${documentIndex.fieldKey} = ${f.fieldKey} AND ${cmp})`;
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

  let q = db.select(docColumns).from(documents).where(rowsWhere).orderBy(orderBy).limit(opts.limit).$dynamic();
  if (!useCursor && opts.offset) q = q.offset(opts.offset);
  const rows = await q;

  const totalRows = await db.select({ n: count() }).from(documents).where(baseWhere);
  return { rows: rows.map(toDomain), total: totalRows[0]?.n ?? 0 };
}

/** One collection's slice of the content-overview counts (the /admin/c home).
 *  `accessFilter` is the caller's compiled read predicate (compileReadFilter) —
 *  applied IN-QUERY so counts can never leak (D17); undefined = unrestricted. */
export interface DocCountScope {
  readonly collection: string;
  readonly accessFilter?: SQL;
}

export interface DocCountRow {
  readonly collection: string;
  readonly status: 'draft' | 'published';
  readonly n: number;
  /** MAX(updated_at) within the scope — the collection's freshness signal. */
  readonly latest: string | null;
}

/** Per-collection, per-status document counts + newest updated_at across the
 *  caller's scopes, in ONE grouped query (documents_collection_status_idx).
 *  Metadata only (no data_json flows), but counts are leak-capable, so each
 *  scope's read predicate narrows in-query — never post-filter — and one Grant
 *  per scope is required (the service read-authorized each collection; the
 *  listTrash scope precedent). */
export async function countDocumentsByCollection(
  db: Database,
  scopes: readonly DocCountScope[],
  _grants: readonly Grant[],
): Promise<DocCountRow[]> {
  if (!scopes.length) return [];
  const preds = scopes.map((s) =>
    s.accessFilter
      ? and(eq(documents.collection, s.collection), s.accessFilter)!
      : eq(documents.collection, s.collection),
  );
  const rows = await db
    .select({
      collection: documents.collection,
      status: documents.status,
      n: count(),
      latest: sql<string | null>`MAX(${documents.updatedAt})`,
    })
    .from(documents)
    .where(or(...preds))
    .groupBy(documents.collection, documents.status);
  return rows.map((r) => ({
    collection: r.collection,
    status: r.status as 'draft' | 'published',
    n: r.n,
    latest: r.latest,
  }));
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
      .select(docColumns)
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
    .select(docColumns)
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

/** Full-text row for `document_fts` (D28) — the FTS5 virtual table lives ONLY in
 *  migration 0007 (never schema.ts), so it is addressed with raw SQL here. */
export interface SearchText {
  readonly title: string | null;
  readonly body: string;
}

/** Batch items keeping `document_fts` in sync with a document write. The FTS row
 *  is replaced wholesale (delete-then-insert), mirroring the document_index sync;
 *  FK cascades cannot clear a virtual table, so deletes are explicit. Uses the
 *  out-of-schema table handle (src/db/fts-table.ts) — D1 batches only PREPARED
 *  statements, never raw sql. */
function ftsSync(
  db: Database,
  documentId: string,
  collection: string,
  search: SearchText | null,
): BatchItem<'sqlite'>[] {
  const items: BatchItem<'sqlite'>[] = [
    db.delete(documentFts).where(eq(documentFts.documentId, documentId)),
  ];
  if (search && (search.title || search.body)) {
    items.push(
      db.insert(documentFts).values({
        documentId,
        collection,
        title: search.title ?? '',
        body: search.body,
      }),
    );
  }
  return items;
}

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
  /** Preserved original creation time (import, D37); defaults to `now`. */
  readonly createdAt?: string;
  readonly publishedAt: string | null;
  readonly index: IndexValue[];
  /** Full-text search row content (D28); null ⇒ nothing searchable. */
  readonly search: SearchText | null;
  /** Outbox event (D33) committed atomically with the write. */
  readonly event?: EventInput;
  /** Initial visibility (import, D37); defaults to the column default 'public'
   *  when omitted. */
  readonly visibility?: Visibility;
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
      createdAt: input.createdAt ?? input.now,
      updatedAt: input.now,
      publishedAt: input.publishedAt,
      ...(input.visibility ? { visibility: input.visibility } : {}),
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
    ...ftsSync(db, input.id, input.collection, input.search),
    ...(input.event ? [eventInsert(db, input.event)] : []),
  ];
  await db.batch(stmts as Batch);
}

export interface UpdateInput {
  readonly id: string;
  readonly collection: string;
  readonly data: Record<string, unknown>;
  readonly status: 'draft' | 'published';
  /** Revision author. NULL for the system actor (D30) — it has no principals
   *  row for the FK to reference; the audit row (surface 'system') carries the
   *  attribution instead. */
  readonly savedBy: string | null;
  readonly now: string;
  readonly publishedAt: string | null;
  /** Pending schedule after this write (D32) — callers preserve the existing
   *  value on ordinary saves; publish/unpublish pass null (publishing clears
   *  the schedule, and a published document can't hold one). */
  readonly publishAt: string | null;
  readonly revision: number;
  readonly index: IndexValue[];
  /** Full-text search row content (D28); null ⇒ nothing searchable. */
  readonly search: SearchText | null;
  /** Outbox event (D33) committed atomically with the write. */
  readonly event?: EventInput;
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
        publishAt: input.publishAt,
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
    ...ftsSync(db, input.id, input.collection, input.search),
    ...(input.event ? [eventInsert(db, input.event)] : []),
  ];
  await db.batch(stmts as Batch);
}

/** Set or clear a document's pending scheduled-publish time (D32). Deliberately
 *  NARROW: data is untouched, so no index/FTS re-sync and NO revision append —
 *  scheduling is not an edit. Witness required (the service authorized
 *  `publish`). */
export async function setPublishAt(
  db: Database,
  input: { readonly id: string; readonly publishAt: string | null; readonly now: string },
  _grant: Grant,
): Promise<void> {
  await db
    .update(documents)
    .set({ publishAt: input.publishAt, updatedAt: input.now })
    .where(eq(documents.id, input.id));
}

/** Set a document's visibility (D50). Deliberately NARROW, mirroring
 *  setPublishAt: data is untouched, so no index/FTS re-sync and NO revision
 *  append — visibility is not an edit, so `updatedAt` is deliberately left
 *  alone (it feeds `dateModified` and the sitemap's `lastmod`; a visibility
 *  flip must not look like a content change). Writes the outbox event
 *  atomically in the same batch (eventInsert precedent). Witness required
 *  (the service authorized `publish`). The service short-circuits when the
 *  value is unchanged, so every call here is a real write. */
export async function setDocumentVisibility(
  db: Database,
  input: {
    readonly id: string;
    readonly collection: string;
    readonly visibility: Visibility;
    readonly now: string;
    readonly event?: EventInput;
  },
  _grant: Grant,
): Promise<void> {
  const stmts: BatchItem<'sqlite'>[] = [
    db.update(documents).set({ visibility: input.visibility }).where(eq(documents.id, input.id)),
    ...(input.event ? [eventInsert(db, input.event)] : []),
  ];
  await db.batch(stmts as Batch);
}

/** Drafts whose schedule is due (D32) — the per-minute drain's selection. NO
 *  witness: this is metadata-only (id + collection, never data_json), read by
 *  the cron job to decide WHAT to attempt; each publish then runs the full
 *  authorize()-gated `setPublished` pipeline (getDocumentMetaForAuth
 *  precedent). Oldest schedules first so a backlog drains in order. */
export async function listDueScheduled(
  db: Database,
  now: string,
  limit: number,
): Promise<{ id: string; collection: string }[]> {
  return db
    .select({ id: documents.id, collection: documents.collection })
    .from(documents)
    .where(and(eq(documents.status, 'draft'), sql`${documents.publishAt} IS NOT NULL`, sql`${documents.publishAt} <= ${now}`))
    .orderBy(documents.publishAt, documents.id)
    .limit(limit);
}

// NOTE: there is deliberately NO hard `deleteDocument` query — deletion is the
// snapshot-then-delete batch in src/db/queries/trash.ts (D29). Don't add one back.

/** Replace the FTS rows for a batch of documents (the rebuild path, D28).
 *  Witness required — the caller has read-authorized each collection. */
export async function replaceFtsRows(
  db: Database,
  rows: readonly { id: string; collection: string; search: SearchText | null }[],
  _grant: Grant,
): Promise<void> {
  if (!rows.length) return;
  const stmts = rows.flatMap((r) => ftsSync(db, r.id, r.collection, r.search));
  await db.batch(stmts as Batch);
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

// ---------------------------------------------------------------------------
// Graph queries (D45) — the /admin/graph explorer's data plumbing.
// ---------------------------------------------------------------------------

export interface GraphNodeScope {
  readonly collection: string;
  /** A DECLARED field key (from titleFieldOf on the validated def) — bound as a
   *  json_extract path parameter, never interpolated. */
  readonly titleFieldKey?: string;
  /** Compiled read predicate, applied IN-QUERY — never post-filter. */
  readonly accessFilter?: SQL;
  readonly limit: number;
}

export interface GraphNodeRow {
  readonly id: string;
  readonly status: 'draft' | 'published';
  readonly publishAt: string | null;
  readonly title: string | null;
}

/** Node metadata + ONE json_extract'd title per row — full `data_json` never
 *  transfers out of D1 (the graph needs no content). Witness required. */
export async function listGraphNodes(
  db: Database,
  scope: GraphNodeScope,
  _grant: Grant,
): Promise<GraphNodeRow[]> {
  const pred = scope.accessFilter
    ? and(eq(documents.collection, scope.collection), scope.accessFilter)!
    : eq(documents.collection, scope.collection);
  const title = scope.titleFieldKey
    ? sql<string | null>`json_extract(${documents.dataJson}, ${'$.' + scope.titleFieldKey})`
    : sql<string | null>`NULL`;
  const rows = await db
    .select({ id: documents.id, status: documents.status, publishAt: documents.publishAt, title })
    .from(documents)
    .where(pred)
    .orderBy(desc(documents.createdAt))
    .limit(scope.limit);
  return rows.map((r) => ({
    id: r.id,
    status: r.status as 'draft' | 'published',
    publishAt: r.publishAt,
    title: r.title,
  }));
}

export interface RelationPair {
  readonly collection: string;
  readonly fieldKey: string;
}

export interface EdgeRow {
  readonly sourceId: string;
  readonly sourceCollection: string;
  readonly fieldKey: string;
  readonly targetId: string;
}

/** Every relation edge site-wide in ONE scan of document_index over the given
 *  (collection, field_key) pairs — covered by document_index_text_idx. Edges
 *  exist only for `index: true` relation fields (toIndex writes them).
 *
 *  ACCESS-BLIND BY DESIGN: document_index has no status/owner columns, so this
 *  cannot self-gate. SERVICE-ONLY — graphData() authorizes every collection,
 *  builds the visible node set under compiled read filters, and drops any edge
 *  whose endpoint is not in it (the backlinks invisible-never-a-leak posture).
 *  The Grant witnesses prove the caller read-authorized each source collection. */
export async function listAllEdges(
  db: Database,
  pairs: readonly RelationPair[],
  limit: number,
  _grants: readonly Grant[],
): Promise<EdgeRow[]> {
  if (!pairs.length) return [];
  const preds = pairs.map(
    (p) => and(eq(documentIndex.collection, p.collection), eq(documentIndex.fieldKey, p.fieldKey))!,
  );
  const rows = await db
    .select({
      sourceId: documentIndex.documentId,
      sourceCollection: documentIndex.collection,
      fieldKey: documentIndex.fieldKey,
      targetId: documentIndex.valueText,
    })
    .from(documentIndex)
    .where(and(or(...preds), sql`${documentIndex.valueText} IS NOT NULL`))
    .limit(limit);
  return rows.filter((r): r is EdgeRow & { targetId: string } => r.targetId !== null);
}
