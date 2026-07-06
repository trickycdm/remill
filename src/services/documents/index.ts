/**
 * Documents service — the save pipeline that every write path (admin, REST, MCP)
 * runs through (steering/SCHEMA_ENGINE.md). On every save:
 *
 *   authorize() → whitelist (reject undeclared fields) → validate (Zod from field
 *   types) → beforeSave transforms → unique checks → atomic write (document +
 *   document_index sync + revision append).
 *
 * The whitelist is the direct fix for Blogmill's mass-assignment hole (D14). It is
 * NEVER bypassed.
 */

import { z } from 'zod';
import type { Database } from '@/db/client';
import type { CollectionDefinition, FieldDescriptor, SaveCtx, ExpandedReference } from '@/fields/types';
import { resolveField, isMultiValued, referencesOf } from '@/fields/registry';
import * as dq from '@/db/queries/documents';
import { getCollection, listCollections as listCollectionDefs } from '@/db/queries/collections';
import { getGrantedDocumentIds } from '@/db/queries/grants';
import { getPrincipalRoleSlugs } from '@/db/queries/roles';
import { getPrincipalTeamIds } from '@/db/queries/teams';
import { authorize, compileReadFilter, resolveAccess, anonymousPrincipal, type Principal } from '@/access';
import { newId } from '@/lib/id';
import { hasLifecycle } from '@/lib/lifecycle';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';
import {
  InputValidationError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
  type ErrorDetails,
} from '@/lib/errors';
import type { DocumentRecord } from '@/db/queries/documents';

export type { DocumentRecord } from '@/db/queries/documents';
export type { ExpandedReference } from '@/fields/types';

/** A read result: the raw document plus (when the collection has referencing
 *  fields) the expansion of each reference into `{id, title, collection}`.
 *  `relations` is a SIBLING of data — data keeps the raw ids, so round-trip
 *  writes are unaffected (B2). */
export type ExpandedDocument = DocumentRecord & {
  readonly relations?: Readonly<Record<string, ExpandedReference | ExpandedReference[]>>;
};

async function loadCollection(db: Database, slug: string): Promise<CollectionDefinition> {
  const def = await getCollection(db, slug);
  if (!def) throw new NotFoundError(`Collection '${slug}'`);
  return def;
}

/**
 * The whitelist + validation step, exported so it can be property-tested in
 * isolation. Rejects any key not declared on the collection (anti-mass-assignment)
 * and validates declared fields with the field types' Zod validators.
 */
export function whitelistAndValidate(
  def: CollectionDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(def.fields.map((f) => f.key));
  const issues: ErrorDetails[] = [];

  for (const key of Object.keys(input)) {
    if (!declared.has(key)) {
      issues.push({ path: key, message: `'${key}' is not a declared field on '${def.slug}'.` });
    }
  }
  if (issues.length) throw new InputValidationError(issues, 'Unknown field(s) rejected');

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) shape[f.key] = resolveField(f).valueSchema as z.ZodTypeAny;
  const schema = z.object(shape).strict();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new InputValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data as Record<string, unknown>;
}

async function runTransforms(
  def: CollectionDefinition,
  data: Record<string, unknown>,
  principalId: string,
  now: string,
  isCreate: boolean,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data };
  for (const field of def.fields) {
    const { ft } = resolveField(field);
    if (!ft.beforeSave) continue;
    const ctx: SaveCtx = { field, collection: def, data: out, principalId, now, isCreate };
    try {
      out[field.key] = await ft.beforeSave(out[field.key] as never, ctx);
    } catch (e) {
      throw new InputValidationError([{ path: field.key, message: (e as Error).message }]);
    }
  }
  return out;
}

/** Which document_index column a field's values occupy. A field type's `toIndex`
 *  returns a number (→ value_num) or a string (→ value_text), but that is only
 *  observable with a concrete value; sort has none and a filter value arrives as a
 *  string, so we map by the field types that index numerically. Keep this in sync
 *  if a new numeric-indexing field type is added (currently `number` and `boolean`;
 *  buildIndex/checkUnique below discriminate by `typeof` where a value IS present). */
const NUMERIC_INDEX_TYPES: ReadonlySet<string> = new Set(['number', 'boolean']);
function indexKind(field: FieldDescriptor): dq.IndexKind {
  return NUMERIC_INDEX_TYPES.has(field.type) ? 'num' : 'text';
}

/** Normalize a raw string filter value to the form the numeric index stores.
 *  boolean fields index 1/0 in value_num, so map truthy literals → '1' (the query
 *  coerces the string with Number()); numeric fields pass through unchanged. */
function coerceNumericFilter(field: FieldDescriptor, raw: string): string {
  if (field.type === 'boolean') return /^(true|1|yes|on)$/i.test(raw.trim()) ? '1' : '0';
  return raw;
}

/** Build document_index rows for every indexed field (SCHEMA_ENGINE.md surface 1).
 *  A multi-valued `toIndex` returns an array — one row PER ELEMENT, so each edge of
 *  a multi-relation is independently filterable and reverse-lookupable (B1). The
 *  sync layer replaces a document's rows wholesale, so N rows need no query change. */
function buildIndex(def: CollectionDefinition, data: Record<string, unknown>): dq.IndexValue[] {
  const rows: dq.IndexValue[] = [];
  for (const field of def.fields) {
    if (!field.index) continue;
    const { ft } = resolveField(field);
    if (!ft.toIndex) continue;
    const idx = ft.toIndex(data[field.key] as never);
    if (idx === null || idx === undefined) continue;
    for (const v of Array.isArray(idx) ? idx : [idx]) {
      rows.push({
        fieldKey: field.key,
        valueText: typeof v === 'string' ? v : null,
        valueNum: typeof v === 'number' ? v : null,
        // Populate the DB uniqueness backing only for unique fields (COR-8). A unique
        // field is always indexed, and never multi-valued (collection validation
        // enforces unique ⇒ index and rejects unique on multi-valued fields).
        uniqueKey: field.unique ? `${def.slug}:${field.key}` : null,
      });
    }
  }
  return rows;
}

/** True when a batch failed on the document_index unique index (COR-8) — the
 *  race-proof backstop behind the app-level `checkUnique` pre-check. */
function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

async function checkUnique(
  db: Database,
  def: CollectionDefinition,
  data: Record<string, unknown>,
  excludeId?: string,
): Promise<void> {
  for (const field of def.fields.filter((f) => f.unique)) {
    const { ft } = resolveField(field);
    const idx = ft.toIndex?.(data[field.key] as never);
    if (idx === null || idx === undefined) continue;
    // Unique + multi-valued is rejected at definition time; iterate defensively
    // per element so the check stays correct even for a scalar-or-array toIndex.
    for (const val of Array.isArray(idx) ? idx : [idx]) {
      if (typeof val === 'string' && val === '') continue;
      const kind: dq.IndexKind = typeof val === 'number' ? 'num' : 'text';
      if (await dq.isIndexValueTaken(db, def.slug, field.key, val, kind, excludeId)) {
        throw new ConflictError(`${field.label ?? field.key} '${val}' is already taken.`);
      }
    }
  }
}

function initialStatus(def: CollectionDefinition): 'draft' | 'published' {
  // lifecycle:'none' docs are ALWAYS born published — status stays load-bearing
  // in the access layer (the `published` condition, publicRead), so opting out
  // of the lifecycle means opting into permanent published-ness (B4).
  if (!hasLifecycle(def)) return 'published';
  return def.workflow?.draftPublish ? 'draft' : 'published';
}

// ---------------------------------------------------------------------------
// Relation read-expansion (B2)
// ---------------------------------------------------------------------------

/** The target's display-title field: the configured `titleField` when it exists
 *  on the target, else the target's first text/slug field. */
function pickTitleField(def: CollectionDefinition, configured?: string): string | undefined {
  if (configured && def.fields.some((f) => f.key === configured)) return configured;
  return def.fields.find((f) => f.type === 'text' || f.type === 'slug')?.key;
}

/**
 * Expand every referencing field's id(s) into `{id, title, collection}`,
 * batch-loading each target collection ONCE per call (no N+1). Titles are a
 * permission-gated read: targets the reader cannot see — and dangling/deleted
 * ids — expand with `title: null` (the raw ids were already visible in data;
 * only the looked-up content is gated). Rows come back unchanged when the
 * collection has no referencing fields.
 */
async function expandRelations(
  db: Database,
  principal: Principal,
  def: CollectionDefinition,
  rows: DocumentRecord[],
  now: string,
): Promise<ExpandedDocument[]> {
  const refFields = def.fields
    .map((field) => ({ field, ref: referencesOf(field) }))
    .filter((x): x is { field: FieldDescriptor; ref: { collection: string; titleField?: string } } => x.ref !== null);
  if (!refFields.length || !rows.length) return rows;

  // Collect the referenced ids per target collection.
  const wanted = new Map<string, Set<string>>();
  for (const { field, ref } of refFields) {
    const set = wanted.get(ref.collection) ?? new Set<string>();
    wanted.set(ref.collection, set);
    for (const row of rows) {
      const v = row.data[field.key];
      for (const id of Array.isArray(v) ? v : v == null ? [] : [v]) {
        if (typeof id === 'string') set.add(id);
      }
    }
  }

  // Batch-load each target's READABLE docs (authorize + compiled filter — an
  // unpublished target reads as title:null for a publicRead-only reader).
  const loaded = new Map<string, { def: CollectionDefinition | null; docs: Map<string, DocumentRecord> }>();
  for (const [target, ids] of wanted) {
    const entry = { def: null as CollectionDefinition | null, docs: new Map<string, DocumentRecord>() };
    loaded.set(target, entry);
    if (!ids.size) continue;
    entry.def = await getCollection(db, target);
    if (!entry.def) continue; // target collection deleted → all titles null
    try {
      const resolved = await resolveAccess(db, principal.id, target);
      const grant = await authorize(db, principal, 'read', { collection: target }, now, resolved);
      const filter = await compileReadFilter(db, principal, target, now, resolved);
      for (const doc of await dq.getDocumentsByIds(db, target, [...ids], filter, grant)) {
        entry.docs.set(doc.id, doc);
      }
    } catch (e) {
      // Reader can't read the target collection at all — expansion stays null.
      if (!(e instanceof ForbiddenError)) throw e;
    }
  }

  return rows.map((row) => {
    const relations: Record<string, ExpandedReference | ExpandedReference[]> = {};
    for (const { field, ref } of refFields) {
      const v = row.data[field.key];
      if (v == null) continue;
      const entry = loaded.get(ref.collection);
      const titleKey = entry?.def ? pickTitleField(entry.def, ref.titleField) : undefined;
      const expand = (id: unknown): ExpandedReference => {
        const target = typeof id === 'string' ? entry?.docs.get(id) : undefined;
        const raw = target && titleKey ? target.data[titleKey] : undefined;
        return {
          id: String(id),
          title: typeof raw === 'string' && raw.length ? raw : null,
          collection: ref.collection,
        };
      };
      relations[field.key] = Array.isArray(v) ? v.map(expand) : expand(v);
    }
    return Object.keys(relations).length ? { ...row, relations } : row;
  });
}

// ---------------------------------------------------------------------------
// Backlinks — the reverse edges of the graph (B3)
// ---------------------------------------------------------------------------

/** One reverse edge: a document that references the asked-about document. */
export interface Backlink {
  readonly id: string;
  /** The SOURCE collection the referrer lives in. */
  readonly collection: string;
  readonly title: string | null;
  readonly status: 'draft' | 'published';
  readonly updatedAt: string;
}

/** Referrers returned per source collection — a display cap, not pagination. */
const BACKLINKS_LIMIT = 50;

/**
 * Documents that REFERENCE the given document through indexed relation fields.
 * Access-gated twice: asking requires `read` on the target document, and each
 * SOURCE collection is read under the caller's own compiled filter — a referrer
 * the reader cannot see is simply absent, never a leak. Only INDEXED relation
 * fields produce backlinks (the edges live in `document_index`).
 */
export async function getBacklinks(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  now: string,
): Promise<Backlink[]> {
  const grant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  const target = await dq.getDocument(db, collectionSlug, id, grant);
  if (!target) throw new NotFoundError('Document');

  const out: Backlink[] = [];
  for (const def of await listCollectionDefs(db)) {
    const fieldKeys = def.fields
      .filter((f) => f.index && referencesOf(f)?.collection === collectionSlug)
      .map((f) => f.key);
    if (!fieldKeys.length) continue;
    let rows: DocumentRecord[];
    try {
      const resolved = await resolveAccess(db, principal.id, def.slug);
      const srcGrant = await authorize(db, principal, 'read', { collection: def.slug }, now, resolved);
      const filter = await compileReadFilter(db, principal, def.slug, now, resolved);
      rows = await dq.listBacklinks(db, def.slug, fieldKeys, id, filter, BACKLINKS_LIMIT, srcGrant);
    } catch (e) {
      // The reader can't read this source collection — its edges are invisible.
      if (!(e instanceof ForbiddenError)) throw e;
      continue;
    }
    const titleKey = pickTitleField(def);
    for (const row of rows) {
      const raw = titleKey ? row.data[titleKey] : undefined;
      out.push({
        id: row.id,
        collection: def.slug,
        title: typeof raw === 'string' && raw.length ? raw : null,
        status: row.status,
        updatedAt: row.updatedAt,
      });
    }
  }
  return out;
}

/** One row of the "Shared with me" surface: a document the principal can read
 *  because someone granted it (directly, via a role, or via a team — D24). */
export interface SharedWithMeRow {
  readonly id: string;
  readonly collection: string;
  readonly title: string | null;
  readonly status: string;
  readonly actions: readonly string[];
  /** null = at least one applicable grant never expires. */
  readonly expiresAt: string | null;
}

/**
 * The documents item-granted to this principal (as itself, its roles, or its
 * teams — never link subjects). UN-GATED identity-scoped read: a principal may
 * always learn what was shared with it. Content still flows through the gated
 * pipeline — per collection we authorize('read') + compile the read filter and
 * batch-read under the witness (getBacklinks pattern), so a grant a collection
 * denies anyway (e.g. revoked role) yields no row.
 */
export async function listSharedWithMe(db: Database, principal: Principal, now: string): Promise<SharedWithMeRow[]> {
  const [roleSlugs, teamIds] = await Promise.all([
    getPrincipalRoleSlugs(db, principal.id),
    getPrincipalTeamIds(db, principal.id),
  ]);
  const granted = (await getGrantedDocumentIds(db, principal.id, roleSlugs, now, undefined, teamIds)).filter((g) =>
    g.actions.includes('read'),
  );
  if (!granted.length) return [];

  // Union actions + keep the longest-lived expiry per document: any unexpired
  // grant keeps access, and null ("never expires") wins outright.
  const byDoc = new Map<string, { actions: Set<string>; expiresAt: string | null; hasNoExpiry: boolean }>();
  for (const g of granted) {
    const entry = byDoc.get(g.documentId) ?? { actions: new Set<string>(), expiresAt: null, hasNoExpiry: false };
    g.actions.forEach((a) => entry.actions.add(a));
    if (g.expiresAt === null) entry.hasNoExpiry = true;
    else if (!entry.hasNoExpiry && (entry.expiresAt === null || g.expiresAt > entry.expiresAt)) {
      entry.expiresAt = g.expiresAt;
    }
    byDoc.set(g.documentId, entry);
  }

  const collectionsById = await dq.getDocumentCollections(db, [...byDoc.keys()]);
  const idsByCollection = new Map<string, string[]>();
  for (const [id, collection] of collectionsById) {
    idsByCollection.set(collection, [...(idsByCollection.get(collection) ?? []), id]);
  }

  const out: SharedWithMeRow[] = [];
  for (const [slug, ids] of idsByCollection) {
    let rows: DocumentRecord[];
    let def: CollectionDefinition;
    try {
      def = await loadCollection(db, slug);
      const resolved = await resolveAccess(db, principal.id, slug);
      const grant = await authorize(db, principal, 'read', { collection: slug }, now, resolved);
      const filter = await compileReadFilter(db, principal, slug, now, resolved);
      rows = await dq.getDocumentsByIds(db, slug, ids, filter, grant);
    } catch (e) {
      if (!(e instanceof ForbiddenError)) throw e;
      continue; // collection unreadable for this principal — its grants are inert
    }
    const titleKey = pickTitleField(def);
    for (const row of rows) {
      const raw = titleKey ? row.data[titleKey] : undefined;
      const entry = byDoc.get(row.id);
      out.push({
        id: row.id,
        collection: slug,
        title: typeof raw === 'string' && raw.length ? raw : null,
        status: row.status,
        actions: [...(entry?.actions ?? [])],
        expiresAt: entry?.hasNoExpiry ? null : (entry?.expiresAt ?? null),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getDocument(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  now: string,
): Promise<ExpandedDocument> {
  const grant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  const doc = await dq.getDocument(db, collectionSlug, id, grant);
  if (!doc) throw new NotFoundError('Document');
  const def = await loadCollection(db, collectionSlug);
  const [expanded] = await expandRelations(db, principal, def, [doc], now);
  return expanded;
}

export interface ListParams {
  readonly page?: number;
  readonly pageSize?: number;
  /** Keyset cursor (opaque) for the DEFAULT sort — the performant path. When set,
   *  it supersedes `page` (COR-7). Obtain it from a prior result's `nextCursor`. */
  readonly cursor?: string;
  readonly status?: 'draft' | 'published';
  /** Exact-match filters by field key (REST `?filter[field]=`). */
  readonly filters?: Record<string, string>;
  /** Sort by field key + direction (REST `?sort=field` / `?sort=-field`). */
  readonly sort?: { field: string; dir: 'asc' | 'desc' };
}

export interface ListResult {
  readonly rows: ExpandedDocument[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Opaque cursor for the next page under the DEFAULT sort; undefined on the last
   *  page or whenever a custom `sort` is active (keyset is (createdAt, id)-only). */
  readonly nextCursor?: string;
}

/** A field must be declared AND indexed to be filtered/sorted on (a 400 per
 *  steering/API_AND_MCP_STANDARDS.md — never silently ignore an unindexed field).
 *  Returns the field descriptor so the caller can read its index kind (COR-3). */
function assertIndexed(def: CollectionDefinition, fieldKey: string, what: string): FieldDescriptor {
  const field = def.fields.find((f) => f.key === fieldKey);
  if (!field || !field.index) {
    throw new BadRequestError(`Field '${fieldKey}' is not indexed; cannot ${what} by it.`);
  }
  return field;
}

/** Opaque keyset cursor: base64 of `createdAt|id` (both ASCII, no `|`). */
function encodeCursor(r: { createdAt: string; id: string }): string {
  return btoa(`${r.createdAt}|${r.id}`);
}
function decodeCursor(s: string): dq.ListCursor | undefined {
  try {
    const raw = atob(s);
    const i = raw.indexOf('|');
    if (i < 0) return undefined;
    return { createdAt: raw.slice(0, i), id: raw.slice(i + 1) };
  } catch {
    return undefined;
  }
}

export async function listDocuments(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  params: ListParams,
  now: string,
): Promise<ListResult> {
  // Resolve permissions + publicRead ONCE and thread into both authorize and the
  // compiled read filter (TD-3) — a single list previously resolved them twice.
  const resolved = await resolveAccess(db, principal.id, collectionSlug);
  const grant = await authorize(db, principal, 'read', { collection: collectionSlug }, now, resolved);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  // The definition drives filter/sort index kinds (COR-3) and relation expansion.
  const def = await loadCollection(db, collectionSlug);
  let filters: dq.ListFilter[] = [];
  let sort: dq.ListSort | undefined;
  const rawFilters = Object.entries(params.filters ?? {});
  if (rawFilters.length || params.sort) {
    filters = rawFilters.map(([fieldKey, value]) => {
      const field = assertIndexed(def, fieldKey, 'filter');
      const kind = indexKind(field);
      return { fieldKey, kind, value: kind === 'num' ? coerceNumericFilter(field, value) : value };
    });
    if (params.sort) {
      const field = assertIndexed(def, params.sort.field, 'sort');
      // A multi-valued field has N index rows per document; the sort correlated
      // subquery would pick an arbitrary one — reject rather than sort randomly.
      // (Filtering stays allowed: matching ANY element is the wanted semantics.)
      if (isMultiValued(field)) {
        throw new BadRequestError(`Field '${params.sort.field}' is multi-valued; cannot sort by it.`);
      }
      sort = { fieldKey: params.sort.field, dir: params.sort.dir, kind: indexKind(field) };
    }
  }

  // Keyset cursor pagination on (createdAt, id) — the performant default path
  // (COR-7). Falls back to page/offset for backward-compatible page-based callers
  // and whenever a custom sort is active.
  const cursor = !sort && params.cursor ? decodeCursor(params.cursor) : undefined;
  const { rows, total } = await dq.listDocuments(
    db,
    collectionSlug,
    {
      limit: pageSize,
      cursor,
      offset: cursor ? undefined : (page - 1) * pageSize,
      status: params.status,
      accessFilter: await compileReadFilter(db, principal, collectionSlug, now, resolved),
      filters,
      sort,
    },
    grant,
  );

  // A full page under the default sort implies there may be more → emit a cursor.
  const nextCursor =
    !sort && rows.length === pageSize ? encodeCursor(rows[rows.length - 1]) : undefined;
  const expanded = await expandRelations(db, principal, def, rows, now);
  return { rows: expanded, total, page, pageSize, nextCursor };
}

/** Resolve a document by its indexed slug-field value (the public URL path,
 *  C2). Reuses the GATED list path, so the caller's compiled filter applies —
 *  anonymous readers resolve publicRead + published documents only. 404s when
 *  the collection has no indexed slug field (id URLs still work). */
export async function getDocumentBySlug(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  slugValue: string,
  now: string,
): Promise<ExpandedDocument> {
  const def = await loadCollection(db, collectionSlug);
  const slugField = def.fields.find((f) => f.type === 'slug' && f.index);
  if (!slugField) throw new NotFoundError('Document');
  const res = await listDocuments(
    db,
    principal,
    collectionSlug,
    { filters: { [slugField.key]: slugValue }, pageSize: 1 },
    now,
  );
  const doc = res.rows[0];
  if (!doc) throw new NotFoundError('Document');
  return doc;
}

/**
 * Read the document a resolved SHARE-LINK grant points at (C3), as an anonymous
 * principal carrying the link identity — the read still runs through
 * `authorize()`, which matches the link grant like any other grant. Returns the
 * definition too (the share page renders through DocumentView). Throws
 * NotFound/Forbidden for a dangling target or a grant without `read`.
 */
export async function getSharedDocument(
  db: Database,
  linkGrant: { documentId: string; subjectId: string },
  now: string,
): Promise<{ doc: ExpandedDocument; def: CollectionDefinition }> {
  const collection = await dq.getDocumentCollection(db, linkGrant.documentId);
  if (!collection) throw new NotFoundError('Document');
  const principal: Principal = { ...anonymousPrincipal('rest'), linkId: linkGrant.subjectId };
  const doc = await getDocument(db, principal, collection, linkGrant.documentId, now);
  const def = await loadCollection(db, collection);
  return { doc, def };
}

export async function listRevisions(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  now: string,
) {
  const grant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  return dq.listRevisions(db, id, grant);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createDocument(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  input: Record<string, unknown>,
  now: string,
): Promise<DocumentRecord> {
  const def = await loadCollection(db, collectionSlug);
  const grant = await authorize(db, principal, 'create', { collection: collectionSlug }, now);

  const validated = whitelistAndValidate(def, input);
  const data = await runTransforms(def, validated, principal.id, now, true);
  await checkUnique(db, def, data);

  const id = newId('document');
  const status = initialStatus(def);
  const publishedAt = status === 'published' ? now : null;
  try {
    await dq.insertDocument(
      db,
      {
        id,
        collection: collectionSlug,
        data,
        status,
        createdBy: principal.id,
        now,
        publishedAt,
        index: buildIndex(def, data),
      },
      grant,
    );
  } catch (e) {
    if (isUniqueConstraintError(e)) throw new ConflictError('A unique field value is already taken.');
    throw e;
  }
  // Return the freshly-written record directly — no re-fetch round-trip (TD-9).
  return {
    id,
    collection: collectionSlug,
    data,
    status,
    createdBy: principal.id,
    createdAt: now,
    updatedAt: now,
    publishedAt,
  };
}

export async function updateDocument(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  input: Record<string, unknown>,
  now: string,
): Promise<DocumentRecord> {
  const def = await loadCollection(db, collectionSlug);
  const readGrant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  const existing = await dq.getDocument(db, collectionSlug, id, readGrant);
  if (!existing) throw new NotFoundError('Document');

  const grant = await authorize(
    db,
    principal,
    'update',
    { collection: collectionSlug, documentId: id, status: existing.status, createdBy: existing.createdBy ?? undefined },
    now,
  );

  // PATCH semantics: merge the whitelisted input over existing data, then validate
  // the full merged document. Strip keys from existing data that are no longer
  // declared (a field removed or retyped away) BEFORE merging, else validation
  // would reject the stale key and the doc could never be saved again (COR-5).
  // Per DATABASE_STANDARDS, such stale values simply drop on this next save.
  const merged = { ...declaredOnly(def, existing.data), ...whitelistOnly(def, input) };
  const validated = whitelistAndValidate(def, merged);
  const data = await runTransforms(def, validated, principal.id, now, false);
  await checkUnique(db, def, data, id);

  try {
    await dq.updateDocument(
      db,
      {
        id,
        collection: collectionSlug,
        data,
        status: existing.status,
        savedBy: principal.id,
        now,
        publishedAt: existing.publishedAt,
        revision: await dq.nextRevisionNumber(db, id),
        index: buildIndex(def, data),
      },
      grant,
    );
  } catch (e) {
    if (isUniqueConstraintError(e)) throw new ConflictError('A unique field value is already taken.');
    throw e;
  }
  // Construct the written record from known values (existing immutables + new data)
  // instead of a re-fetch round-trip (TD-9).
  return {
    ...existing,
    data,
    status: existing.status,
    updatedAt: now,
    publishedAt: existing.publishedAt,
  };
}

/** Reject undeclared keys but don't validate values (used before merge). */
function whitelistOnly(
  def: CollectionDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(def.fields.map((f: FieldDescriptor) => f.key));
  const bad = Object.keys(input).filter((k) => !declared.has(k));
  if (bad.length) {
    throw new InputValidationError(
      bad.map((k) => ({ path: k, message: `'${k}' is not a declared field on '${def.slug}'.` })),
    );
  }
  return input;
}

/** Keep only currently-declared keys, silently dropping the rest (used on EXISTING
 *  data before a merge, where stale values from removed/retyped fields must not
 *  block the save — COR-5). Unlike whitelistOnly, it never throws. */
function declaredOnly(
  def: CollectionDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(def.fields.map((f: FieldDescriptor) => f.key));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (declared.has(k)) out[k] = v;
  return out;
}

export async function setPublished(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  publish: boolean,
  now: string,
): Promise<DocumentRecord> {
  const readGrant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  const existing = await dq.getDocument(db, collectionSlug, id, readGrant);
  if (!existing) throw new NotFoundError('Document');

  const def = await loadCollection(db, collectionSlug);
  if (!hasLifecycle(def)) {
    throw new BadRequestError(`'${collectionSlug}' has no publish lifecycle.`);
  }
  const grant = await authorize(
    db,
    principal,
    'publish',
    { collection: collectionSlug, documentId: id, status: existing.status },
    now,
  );
  const status = publish ? 'published' : 'draft';
  const publishedAt = publish ? (existing.publishedAt ?? now) : null;
  await dq.updateDocument(
    db,
    {
      id,
      collection: collectionSlug,
      data: existing.data,
      status,
      savedBy: principal.id,
      now,
      publishedAt,
      revision: await dq.nextRevisionNumber(db, id),
      index: buildIndex(def, existing.data),
    },
    grant,
  );
  // Construct the written record from known values — no re-fetch round-trip (TD-9).
  return { ...existing, status, updatedAt: now, publishedAt };
}

export async function deleteDocument(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  now: string,
): Promise<void> {
  const readGrant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  const existing = await dq.getDocument(db, collectionSlug, id, readGrant);
  if (!existing) throw new NotFoundError('Document');
  const grant = await authorize(db, principal, 'delete', { collection: collectionSlug, documentId: id }, now);
  await dq.deleteDocument(db, id, grant);
}

/** Restore a prior revision as a new save (append-only history is preserved). */
export async function restoreRevision(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  revision: number,
  now: string,
): Promise<DocumentRecord> {
  const readGrant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  const revs = await dq.listRevisions(db, id, readGrant);
  const target = revs.find((r) => r.revision === revision);
  if (!target) throw new NotFoundError(`Revision ${revision}`);
  return updateDocument(db, principal, collectionSlug, id, target.data, now);
}
