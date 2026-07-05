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
import type { CollectionDefinition, FieldDescriptor, SaveCtx } from '@/fields/types';
import { resolveField, isMultiValued } from '@/fields/registry';
import * as dq from '@/db/queries/documents';
import { getCollection } from '@/db/queries/collections';
import { authorize, compileReadFilter, resolveAccess, type Principal } from '@/access';
import { newId } from '@/lib/id';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';
import {
  InputValidationError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  type ErrorDetails,
} from '@/lib/errors';
import type { DocumentRecord } from '@/db/queries/documents';

export type { DocumentRecord } from '@/db/queries/documents';

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
  return def.workflow?.draftPublish ? 'draft' : 'published';
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
): Promise<DocumentRecord> {
  const grant = await authorize(db, principal, 'read', { collection: collectionSlug, documentId: id }, now);
  const doc = await dq.getDocument(db, collectionSlug, id, grant);
  if (!doc) throw new NotFoundError('Document');
  return doc;
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
  readonly rows: DocumentRecord[];
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

  // Resolve filter/sort index kinds from the collection definition (COR-3): a
  // number/boolean field indexes into value_num, everything else into value_text.
  let filters: dq.ListFilter[] = [];
  let sort: dq.ListSort | undefined;
  const rawFilters = Object.entries(params.filters ?? {});
  if (rawFilters.length || params.sort) {
    const def = await loadCollection(db, collectionSlug);
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
  return { rows, total, page, pageSize, nextCursor };
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
