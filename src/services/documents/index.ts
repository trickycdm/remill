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
import type {
  CollectionDefinition,
  FieldDescriptor,
  SaveCtx,
  ExpandedReference,
  MediaMeta,
} from '@/fields/types';
import { resolveField, isMultiValued, referencesOf } from '@/fields/registry';
import * as dq from '@/db/queries/documents';
import { getMediaByIds } from '@/db/queries/media';
import { trashDocument as trashDocumentRow } from '@/db/queries/trash';
import { TRASH_MAX_REVISIONS } from '@/config/retention';
import { getCollection, listCollections as listCollectionDefs } from '@/db/queries/collections';
import { getGrantedDocumentIds } from '@/db/queries/grants';
import { getPrincipalRoleSlugs } from '@/db/queries/roles';
import { getPrincipalTeamIds } from '@/db/queries/teams';
import {
  authorize,
  compileReadFilter,
  resolveAccess,
  anonymousPrincipal,
  systemPrincipal,
  type Principal,
  type ResolvedAccess,
} from '@/access';
import type { Grant } from '@/access/grant';
import { collectionsWithAction, getPrincipalPermissions } from '@/services/access';
import { newId } from '@/lib/id';
import { hasLifecycle } from '@/lib/lifecycle';
import { titleFieldOf } from '@/lib/def-helpers';
import { isSeoFieldKey } from '@/lib/seo-keys';
import { renderDocument, rendersFor, textRenderOf } from '@/templates/renders';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/config/constants';
import {
  InputValidationError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
  type ErrorDetails,
} from '@/lib/errors';
import { VISIBILITIES, type DocumentRecord, type Visibility } from '@/db/queries/documents';

export type { DocumentRecord, Visibility } from '@/db/queries/documents';
export { VISIBILITIES } from '@/db/queries/documents';
export type { ExpandedReference } from '@/fields/types';
export { FILTER_OPS } from '@/db/queries/documents';
export type { FilterOp } from '@/db/queries/documents';

/** A read result: the raw document plus (when the collection has referencing
 *  fields) the expansion of each reference into `{id, title, collection}`.
 *  `relations` is a SIBLING of data — data keeps the raw ids, so round-trip
 *  writes are unaffected (B2). */
export type ExpandedDocument = DocumentRecord & {
  readonly relations?: Readonly<Record<string, ExpandedReference | ExpandedReference[]>>;
  /** Media-table display metadata per `media` field (alt + intrinsic dims),
   *  attached beside data (C1). Present only for fields whose value resolved. */
  readonly media?: Readonly<Record<string, MediaMeta>>;
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
 *  sync layer replaces a document's rows wholesale, so N rows need no query change.
 *  Exported for the trash restore path (D29), which re-indexes a snapshot against
 *  the CURRENT definition. */
export function buildIndex(
  def: CollectionDefinition,
  data: Record<string, unknown>,
): dq.IndexValue[] {
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

/** Build the document's FTS row (D28): `title` from the collection's display
 *  title field (pickTitleField — same heuristic relation expansion uses), `body`
 *  from every field with searchable text. Fields need NOT be `index:true` — FTS
 *  is its own surface. `toSearchText` supplies FULL text (markdown/html strip to
 *  plain text untruncated); of the rest, only PROSE types fall back to their
 *  string `toIndex` output. Exported for the rebuild path (src/services/search). */
/** Types whose `toIndex` output is human-readable prose, safe for the FTS body
 *  and the excerpts derived from it (og/meta descriptions, discovery feeds).
 *  Identifier-shaped output (slug URLs, med_/doc_ ids, ISO datetimes) is for
 *  the document_index filter surface, never the search body — it pollutes FTS
 *  matches and leaks machine ids into share previews. */
const PROSE_FALLBACK_TYPES = new Set(['text', 'tags', 'select']);

export function buildSearchText(
  def: CollectionDefinition,
  data: Record<string, unknown>,
): dq.SearchText | null {
  const titleKey = pickTitleField(def);
  const rawTitle = titleKey ? data[titleKey] : undefined;
  const title = typeof rawTitle === 'string' && rawTitle.length ? rawTitle : null;

  const parts: string[] = [];
  for (const field of def.fields) {
    if (field.key === titleKey) continue; // already the weighted title column
    // D52 SEO override fields (seo_title/meta_description/social_image) are
    // author-controlled metadata, not reading content — keep them out of the
    // indexed/excerpted body text.
    if (isSeoFieldKey(field.key)) continue;
    const { ft } = resolveField(field);
    const v = data[field.key];
    if (v === null || v === undefined) continue;
    let text: string | null = null;
    if (ft.toSearchText) {
      text = ft.toSearchText(v as never);
    } else if (ft.toIndex && PROSE_FALLBACK_TYPES.has(field.type)) {
      const idx = ft.toIndex(v as never);
      const strings = (Array.isArray(idx) ? idx : [idx]).filter(
        (x): x is string => typeof x === 'string',
      );
      text = strings.length ? strings.join(' ') : null;
    }
    if (text) parts.push(text);
  }
  const body = parts.join('\n');
  if (!title && !body) return null;
  return { title, body };
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

/** Revision author for a write: the system actor (D30) has NO principals row
 *  for `document_revisions.saved_by` to reference, so its revisions carry NULL —
 *  the audit row (surface 'system') is the attribution. */
function revisionAuthor(principal: Principal): string | null {
  return principal.kind === 'system' ? null : principal.id;
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

// The display-title heuristic moved to src/lib/def-helpers.ts (titleFieldOf,
// D35) so feeds/OG/homepage share it with search indexing and relation
// expansion — one heuristic, every surface.
const pickTitleField = titleFieldOf;

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
    .filter(
      (x): x is { field: FieldDescriptor; ref: { collection: string; titleField?: string } } =>
        x.ref !== null,
    );
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
  const loaded = new Map<
    string,
    { def: CollectionDefinition | null; docs: Map<string, DocumentRecord> }
  >();
  for (const [target, ids] of wanted) {
    const entry = {
      def: null as CollectionDefinition | null,
      docs: new Map<string, DocumentRecord>(),
    };
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

/**
 * Attach display metadata (alt text, intrinsic dimensions) for every `media`
 * field value, batch-loading the `media` table ONCE (the relation-expansion
 * pattern, no N+1). A SIBLING of data — data keeps the raw media id. Gated once
 * on `read` of the `media` collection (publicRead, so anonymous readers pass);
 * a reader who cannot read media — or a deleted asset — simply gets no `media`
 * sibling, never a throw, so a public page can't 500 over missing alt. Rows come
 * back unchanged when the collection has no media fields.
 */
async function expandMedia(
  db: Database,
  principal: Principal,
  def: CollectionDefinition,
  rows: ExpandedDocument[],
  now: string,
): Promise<ExpandedDocument[]> {
  const mediaFields = def.fields.filter((f) => f.type === 'media');
  if (!mediaFields.length || !rows.length) return rows;

  const ids = new Set<string>();
  for (const field of mediaFields) {
    for (const row of rows) {
      const v = row.data[field.key];
      if (typeof v === 'string' && v) ids.add(v);
    }
  }
  if (!ids.size) return rows;

  try {
    const resolved = await resolveAccess(db, principal.id, 'media');
    await authorize(db, principal, 'read', { collection: 'media' }, now, resolved);
  } catch (e) {
    if (e instanceof ForbiddenError) return rows; // media unreadable → no expansion
    throw e;
  }
  const loaded = await getMediaByIds(db, [...ids]);

  return rows.map((row) => {
    const media: Record<string, MediaMeta> = {};
    for (const field of mediaFields) {
      const v = row.data[field.key];
      const rec = typeof v === 'string' ? loaded.get(v) : undefined;
      if (rec)
        media[field.key] = { id: rec.id, alt: rec.alt, width: rec.width, height: rec.height };
    }
    return Object.keys(media).length ? { ...row, media } : row;
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
  const grant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
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
      const srcGrant = await authorize(
        db,
        principal,
        'read',
        { collection: def.slug },
        now,
        resolved,
      );
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
export async function listSharedWithMe(
  db: Database,
  principal: Principal,
  now: string,
): Promise<SharedWithMeRow[]> {
  const [roleSlugs, teamIds] = await Promise.all([
    getPrincipalRoleSlugs(db, principal.id),
    getPrincipalTeamIds(db, principal.id),
  ]);
  const granted = (
    await getGrantedDocumentIds(db, principal.id, roleSlugs, now, undefined, teamIds)
  ).filter((g) => g.actions.includes('read'));
  if (!granted.length) return [];

  // Union actions + keep the longest-lived expiry per document: any unexpired
  // grant keeps access, and null ("never expires") wins outright.
  const byDoc = new Map<
    string,
    { actions: Set<string>; expiresAt: string | null; hasNoExpiry: boolean }
  >();
  for (const g of granted) {
    const entry = byDoc.get(g.documentId) ?? {
      actions: new Set<string>(),
      expiresAt: null,
      hasNoExpiry: false,
    };
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
  const grant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
  const doc = await dq.getDocument(db, collectionSlug, id, grant);
  if (!doc) throw new NotFoundError('Document');
  const def = await loadCollection(db, collectionSlug);
  const [expanded] = await expandRelations(db, principal, def, [doc], now);
  const [withMedia] = await expandMedia(db, principal, def, [expanded], now);
  return withMedia;
}

/**
 * Text render (D47): a role-tailored markdown view of one document, produced by
 * the pure per-template renders in `@/templates/renders`. Rides the same gated
 * read as `getDocument` — no new action, no new gates. The render NAME is code
 * metadata (like template keys), so an unknown name 422s BEFORE the document
 * read — never an existence oracle.
 */
export async function renderDocumentText(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  opts: { readonly render: string; readonly budget?: number; readonly baseUrl?: string },
  now: string,
): Promise<string> {
  const def = await loadCollection(db, collectionSlug);
  const render = textRenderOf(def.template, opts.render);
  if (!render) {
    const available = rendersFor(def.template);
    throw new InputValidationError([
      {
        path: 'render',
        message: available.length
          ? `Unknown render '${opts.render}' — available: ${available.join(', ')}`
          : `Collection '${def.slug}' has no text renders`,
      },
    ]);
  }
  if (opts.budget !== undefined && (!Number.isInteger(opts.budget) || opts.budget <= 0)) {
    throw new InputValidationError([
      { path: 'budget', message: 'budget must be a positive integer (approximate tokens)' },
    ]);
  }
  const doc = await getDocument(db, principal, collectionSlug, id, now);
  const backlinks = render.needsBacklinks
    ? await getBacklinks(db, principal, collectionSlug, id, now)
    : [];
  return renderDocument(def, doc, backlinks, opts);
}

export interface ListParams {
  readonly page?: number;
  readonly pageSize?: number;
  /** Keyset cursor (opaque) for the DEFAULT sort — the performant path. When set,
   *  it supersedes `page` (COR-7). Obtain it from a prior result's `nextCursor`. */
  readonly cursor?: string;
  readonly status?: 'draft' | 'published';
  /** Filters by field key (REST `?filter[field]=` / `?filter[field][op]=`, D28).
   *  A plain string is an exact match; an object carries operator → value
   *  entries, so a range is `{ gte: '10', lte: '20' }` on one field. */
  readonly filters?: Record<string, string | Readonly<Partial<Record<dq.FilterOp, string>>>>;
  /** Sort by field key + direction (REST `?sort=field` / `?sort=-field`). */
  readonly sort?: { field: string; dir: 'asc' | 'desc' };
}

/** Cap on `in` filter set size (D28) — bounds the compiled IN (...) list. */
export const MAX_IN_FILTER_VALUES = 20;

/** Compile one field's filter spec into ListFilters, validating op semantics. */
function compileFilters(
  def: CollectionDefinition,
  fieldKey: string,
  spec: string | Readonly<Partial<Record<dq.FilterOp, string>>>,
): dq.ListFilter[] {
  const field = assertIndexed(def, fieldKey, 'filter');
  const kind = indexKind(field);
  const entries: [string, string][] =
    typeof spec === 'string'
      ? [['eq', spec]]
      : Object.entries(spec).map(([o, v]) => [o, String(v)]);
  return entries.map(([op, value]) => {
    if (!dq.FILTER_OPS.includes(op as dq.FilterOp)) {
      throw new BadRequestError(
        `Unknown filter operator '${op}' (expected ${dq.FILTER_OPS.join('/')}).`,
      );
    }
    if (op === 'contains' && kind === 'num') {
      throw new BadRequestError(
        `Field '${fieldKey}' is numeric; 'contains' applies to text fields.`,
      );
    }
    if (op === 'in') {
      const parts = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length || parts.length > MAX_IN_FILTER_VALUES) {
        throw new BadRequestError(
          `'in' filter takes 1–${MAX_IN_FILTER_VALUES} comma-separated values.`,
        );
      }
      const coerced = kind === 'num' ? parts.map((p) => coerceNumericFilter(field, p)) : parts;
      return { fieldKey, kind, op: op as dq.FilterOp, value: coerced.join(',') };
    }
    return {
      fieldKey,
      kind,
      op: op as dq.FilterOp,
      value: kind === 'num' ? coerceNumericFilter(field, value) : value,
    };
  });
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
  const grant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug },
    now,
    resolved,
  );

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  // The definition drives filter/sort index kinds (COR-3) and relation expansion.
  const def = await loadCollection(db, collectionSlug);
  let filters: dq.ListFilter[] = [];
  let sort: dq.ListSort | undefined;
  const rawFilters = Object.entries(params.filters ?? {});
  if (rawFilters.length || params.sort) {
    filters = rawFilters.flatMap(([fieldKey, spec]) => compileFilters(def, fieldKey, spec));
    if (params.sort) {
      const field = assertIndexed(def, params.sort.field, 'sort');
      // A multi-valued field has N index rows per document; the sort correlated
      // subquery would pick an arbitrary one — reject rather than sort randomly.
      // (Filtering stays allowed: matching ANY element is the wanted semantics.)
      if (isMultiValued(field)) {
        throw new BadRequestError(
          `Field '${params.sort.field}' is multi-valued; cannot sort by it.`,
        );
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
  const withMedia = await expandMedia(db, principal, def, expanded, now);
  return { rows: withMedia, total, page, pageSize, nextCursor };
}

/** One collection's card on the content home: the definition, with document
 *  counts + freshness attached when the caller can read the collection. */
export interface ContentOverviewItem {
  readonly def: CollectionDefinition;
  /** Present only when the caller can read the collection; counts reflect the
   *  caller's compiled read filter (an `own`-conditioned author counts their
   *  own drafts, not anyone else's). */
  readonly counts?: { readonly published: number; readonly draft: number };
  /** MAX(updated_at) among the caller-visible documents. */
  readonly lastUpdatedAt?: string;
  /** Whether the caller may create documents here — UI-hiding only (the create
   *  pipeline's authorize() is the enforcement). */
  readonly canCreate: boolean;
}

/**
 * The content home's per-collection summary (/admin/c): every collection
 * definition, with counts + freshness for the collections the caller can read.
 * Pre-scoped via collectionsWithAction (no deny-audit spray — ACCESS_CONTROL's
 * capability pre-check pattern, the listTrash precedent), then each readable
 * collection is read-authorized for its Grant, and the caller's compiled read
 * filter narrows the ONE grouped count query in-query (D17 — counts never
 * leak). NOTE: like collectionsWithAction itself, publicRead does not widen
 * the pre-check — a principal with no explicit read permission gets the card
 * without counts.
 */
export async function contentOverview(
  db: Database,
  principal: Principal,
  now: string,
): Promise<ContentOverviewItem[]> {
  const defs = await listCollectionDefs(db);
  const readable = await collectionsWithAction(db, principal, 'read');
  const creatable = await collectionsWithAction(db, principal, 'create');
  const readableDefs = defs.filter((d) => readable === '*' || readable.includes(d.slug));

  // Resolve permissions ONCE; per-collection publicRead comes from the defs we
  // already hold (TD-3 — no N re-resolutions).
  const permissions = await getPrincipalPermissions(db, principal.id);
  const grants: Grant[] = [];
  const scopes: dq.DocCountScope[] = [];
  for (const def of readableDefs) {
    const resolved: ResolvedAccess = { permissions, publicRead: def.access?.publicRead === true };
    grants.push(await authorize(db, principal, 'read', { collection: def.slug }, now, resolved));
    scopes.push({
      collection: def.slug,
      accessFilter: await compileReadFilter(db, principal, def.slug, now, resolved),
    });
  }

  const rows = scopes.length ? await dq.countDocumentsByCollection(db, scopes, grants) : [];
  const bySlug = new Map<string, { published: number; draft: number; latest?: string }>();
  for (const def of readableDefs) bySlug.set(def.slug, { published: 0, draft: 0 });
  for (const r of rows) {
    const entry = bySlug.get(r.collection);
    if (!entry) continue;
    if (r.status === 'published') entry.published = r.n;
    else entry.draft = r.n;
    if (r.latest && (!entry.latest || r.latest > entry.latest)) entry.latest = r.latest;
  }

  return defs.map((def) => {
    const entry = bySlug.get(def.slug);
    const canCreate = creatable === '*' || creatable.includes(def.slug);
    return entry
      ? {
          def,
          counts: { published: entry.published, draft: entry.draft },
          lastUpdatedAt: entry.latest,
          canCreate,
        }
      : { def, canCreate };
  });
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
  const grant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
  return dq.listRevisions(db, id, grant);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Preserved fields an IMPORT (D37) may carry into a create. Internal to the
 *  transfer service — which validates the shape and enforces the publish gate
 *  for `status: 'published'` lines; ordinary creates never pass this. */
export interface CreateOverrides {
  readonly id?: string;
  readonly status?: 'draft' | 'published';
  readonly createdAt?: string;
  readonly publishedAt?: string | null;
  /** Initial visibility (import, D37); defaults to 'public'. */
  readonly visibility?: Visibility;
}

const DOC_ID_RE = /^doc_[A-Za-z0-9_-]+$/;

export async function createDocument(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  input: Record<string, unknown>,
  now: string,
  overrides?: CreateOverrides,
): Promise<DocumentRecord> {
  const def = await loadCollection(db, collectionSlug);
  const grant = await authorize(db, principal, 'create', { collection: collectionSlug }, now);

  const validated = whitelistAndValidate(def, input);
  const data = await runTransforms(def, validated, principal.id, now, true);
  await checkUnique(db, def, data);

  if (overrides?.id !== undefined && !DOC_ID_RE.test(overrides.id)) {
    throw new InputValidationError([
      { path: 'id', message: "Preserved ids must match 'doc_' + [A-Za-z0-9_-]." },
    ]);
  }
  const id = overrides?.id ?? newId('document');
  const status = overrides?.status ?? initialStatus(def);
  const publishedAt = status === 'published' ? (overrides?.publishedAt ?? now) : null;
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
        createdAt: overrides?.createdAt,
        publishedAt,
        visibility: overrides?.visibility,
        index: buildIndex(def, data),
        search: buildSearchText(def, data),
        event: {
          type: 'document.created',
          collection: collectionSlug,
          resource: id,
          principalId: principal.id,
          at: now,
        },
      },
      grant,
    );
  } catch (e) {
    if (isUniqueConstraintError(e))
      throw new ConflictError('A unique field value is already taken.');
    throw e;
  }
  // Return the freshly-written record directly — no re-fetch round-trip (TD-9).
  return {
    id,
    collection: collectionSlug,
    data,
    status,
    createdBy: principal.id,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: now,
    publishedAt,
    publishAt: null,
    visibility: overrides?.visibility ?? 'public',
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
  const readGrant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
  const existing = await dq.getDocument(db, collectionSlug, id, readGrant);
  if (!existing) throw new NotFoundError('Document');

  const grant = await authorize(
    db,
    principal,
    'update',
    {
      collection: collectionSlug,
      documentId: id,
      status: existing.status,
      createdBy: existing.createdBy ?? undefined,
    },
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
        savedBy: revisionAuthor(principal),
        now,
        publishedAt: existing.publishedAt,
        publishAt: existing.publishAt, // an ordinary edit never touches the schedule
        revision: await dq.nextRevisionNumber(db, id),
        index: buildIndex(def, data),
        search: buildSearchText(def, data),
        event: {
          type: 'document.updated',
          collection: collectionSlug,
          resource: id,
          principalId: principal.id,
          at: now,
        },
      },
      grant,
    );
  } catch (e) {
    if (isUniqueConstraintError(e))
      throw new ConflictError('A unique field value is already taken.');
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
  const readGrant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
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
      savedBy: revisionAuthor(principal),
      now,
      publishedAt,
      // Publishing consumes any pending schedule (D32); unpublishing can't
      // leave one behind (a published doc never holds a schedule).
      publishAt: null,
      revision: await dq.nextRevisionNumber(db, id),
      index: buildIndex(def, existing.data),
      search: buildSearchText(def, existing.data),
      event: {
        type: publish ? 'document.published' : 'document.unpublished',
        collection: collectionSlug,
        resource: id,
        principalId: principal.id,
        at: now,
      },
    },
    grant,
  );
  // Construct the written record from known values — no re-fetch round-trip (TD-9).
  return { ...existing, status, updatedAt: now, publishedAt, publishAt: null };
}

/**
 * Set (or cancel, with null) a draft's scheduled-publish time (D32). Requires
 * the `publish` action — scheduling IS a deferred publish decision. The write
 * is narrow (no data change ⇒ no revision, no index churn): the per-minute
 * drain later runs the due draft through the full `setPublished` pipeline as
 * the system actor.
 */
export async function scheduleDocument(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  publishAt: string | null,
  now: string,
): Promise<DocumentRecord> {
  const readGrant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
  const existing = await dq.getDocument(db, collectionSlug, id, readGrant);
  if (!existing) throw new NotFoundError('Document');

  const def = await loadCollection(db, collectionSlug);
  if (!hasLifecycle(def)) {
    throw new BadRequestError(`'${collectionSlug}' has no publish lifecycle.`);
  }
  if (publishAt !== null) {
    if (Number.isNaN(Date.parse(publishAt))) {
      throw new InputValidationError([
        { path: 'publishAt', message: 'A valid ISO-8601 datetime is required.' },
      ]);
    }
    if (existing.status === 'published') {
      throw new BadRequestError('Already published — unpublish first to schedule.');
    }
  }
  // A publish_at in the past is allowed: the next drain publishes it (documented).
  const grant = await authorize(
    db,
    principal,
    'publish',
    {
      collection: collectionSlug,
      documentId: id,
      status: existing.status,
      createdBy: existing.createdBy ?? undefined,
    },
    now,
  );
  await dq.setPublishAt(db, { id, publishAt, now }, grant);
  return { ...existing, publishAt, updatedAt: now };
}

/**
 * Set a document's visibility (D50: public/unlisted/private), modelled on
 * `scheduleDocument` — a narrow write (no data change, no revision, no index
 * churn). Changing visibility is a publication decision, so it requires
 * `publish`, same as schedule/publish. Allowed on drafts too: it is remembered
 * and takes effect once the document is published; the scheduled-publish drain
 * leaves it untouched. A no-op call (the value already matches) short-circuits
 * after the permission check — no write, no revision-adjacent `updatedAt`
 * bump, no outbox event.
 */
export async function setVisibility(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  visibility: Visibility,
  now: string,
): Promise<DocumentRecord> {
  const readGrant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
  const existing = await dq.getDocument(db, collectionSlug, id, readGrant);
  if (!existing) throw new NotFoundError('Document');

  if (!VISIBILITIES.includes(visibility)) {
    throw new InputValidationError([
      { path: 'visibility', message: `visibility must be one of: ${VISIBILITIES.join(', ')}` },
    ]);
  }

  const grant = await authorize(
    db,
    principal,
    'publish',
    {
      collection: collectionSlug,
      documentId: id,
      status: existing.status,
      visibility: existing.visibility,
    },
    now,
  );

  if (existing.visibility === visibility) return existing;

  await dq.setDocumentVisibility(
    db,
    {
      id,
      collection: collectionSlug,
      visibility,
      now,
      event: {
        type: 'document.visibility_changed',
        collection: collectionSlug,
        resource: id,
        principalId: principal.id,
        at: now,
      },
    },
    grant,
  );
  return { ...existing, visibility };
}

/**
 * The per-minute scheduled-publish drain (D32), called from cron
 * (src/jobs/index.ts — the purgeExpiredTrash pattern). Selects due drafts with
 * a witness-free metadata query, then publishes EACH through the full
 * `setPublished` pipeline as the SYSTEM actor (D30) — full validation, a
 * revision append, and one attributed audit row (surface 'system') per
 * publish; `publish_at` clears in the same atomic update. One failing document
 * never blocks the rest: failures log, the schedule stays set, and the next
 * drain retries. Returns the number published (for tests/observability).
 */
export async function drainScheduledPublishes(db: Database, now: string): Promise<number> {
  const DRAIN_LIMIT = 50; // a minute's backlog beyond this drains next minute
  const due = await dq.listDueScheduled(db, now, DRAIN_LIMIT);
  let published = 0;
  for (const doc of due) {
    try {
      await setPublished(db, systemPrincipal(), doc.collection, doc.id, true, now);
      published += 1;
    } catch (e) {
      console.error(`[cron] scheduled publish failed for ${doc.collection}/${doc.id}`, e);
    }
  }
  return published;
}

/** Delete = snapshot-then-delete (D29): the document + its newest revisions are
 *  copied into `document_trash`, then the original row is hard-deleted (FK
 *  cascades clear index/revisions/grants; the FTS row goes in the same batch).
 *  Recoverable from /admin/trash (or REST /api/trash) for TRASH_RETENTION_DAYS. */
export async function deleteDocument(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  id: string,
  now: string,
): Promise<void> {
  const readGrant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
  const existing = await dq.getDocument(db, collectionSlug, id, readGrant);
  if (!existing) throw new NotFoundError('Document');
  const grant = await authorize(
    db,
    principal,
    'delete',
    { collection: collectionSlug, documentId: id },
    now,
  );
  const revisions = (await dq.listRevisions(db, id, readGrant))
    .slice(0, TRASH_MAX_REVISIONS)
    .map((r) => ({ revision: r.revision, data: r.data, savedBy: r.savedBy, savedAt: r.savedAt }));
  await trashDocumentRow(
    db,
    {
      documentId: id,
      collection: collectionSlug,
      data: existing.data,
      status: existing.status,
      revisions,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      publishedAt: existing.publishedAt,
      visibility: existing.visibility,
      deletedBy: principal.id,
      deletedAt: now,
      event: {
        type: 'document.deleted',
        collection: collectionSlug,
        resource: id,
        principalId: principal.id,
        at: now,
      },
    },
    grant,
  );
}

// ---------------------------------------------------------------------------
// Bulk actions (D39)
// ---------------------------------------------------------------------------

export const BULK_OPS = ['publish', 'unpublish', 'trash'] as const;
export type BulkOp = (typeof BULK_OPS)[number];

/** Cap on ids per bulk request (D39) — bounds the per-item loop. */
export const MAX_BULK_IDS = 100;

export interface BulkResult {
  readonly ok: number;
  readonly failed: number;
  readonly errors: { id: string; error: string }[];
}

/**
 * Bulk publish/unpublish/trash (D39): loops the EXISTING single-item services
 * per id — per-item authorize, audit, revision, and outbox event all
 * preserved; one failing item never blocks the rest, and completed items are
 * never rolled back (documented partial-failure semantics). No bulk REST/MCP
 * surface — agents compose the per-item tools.
 */
export async function bulkDocuments(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  op: BulkOp,
  ids: readonly string[],
  now: string,
): Promise<BulkResult> {
  if (!BULK_OPS.includes(op)) {
    throw new BadRequestError(`Unknown bulk op '${String(op)}' (expected ${BULK_OPS.join('/')}).`);
  }
  if (ids.length === 0) throw new BadRequestError('Select at least one item.');
  if (ids.length > MAX_BULK_IDS) {
    throw new BadRequestError(`Bulk actions take at most ${MAX_BULK_IDS} items at once.`);
  }
  let ok = 0;
  const errors: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      if (op === 'trash') await deleteDocument(db, principal, collectionSlug, id, now);
      else await setPublished(db, principal, collectionSlug, id, op === 'publish', now);
      ok += 1;
    } catch (e) {
      errors.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed: errors.length, errors };
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
  const readGrant = await authorize(
    db,
    principal,
    'read',
    { collection: collectionSlug, documentId: id },
    now,
  );
  const revs = await dq.listRevisions(db, id, readGrant);
  const target = revs.find((r) => r.revision === revision);
  if (!target) throw new NotFoundError(`Revision ${revision}`);
  return updateDocument(db, principal, collectionSlug, id, target.data, now);
}

// ---------------------------------------------------------------------------
// The relation graph (D45) — nodes + edges for /admin/graph.
// ---------------------------------------------------------------------------

export const GRAPH_MAX_NODES = 1500;
export const GRAPH_MAX_EDGES = 4000;

export interface GraphNode {
  readonly id: string;
  readonly collection: string;
  readonly title: string;
  /** 'scheduled' is DERIVED: stored status 'draft' + a pending publishAt (D32). */
  readonly status: 'draft' | 'published' | 'scheduled';
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly collection: string;
  readonly fieldKey: string;
}

export interface GraphData {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
  /** Legend entries, definition order — only collections the caller can read. */
  readonly collections: { readonly slug: string; readonly name: string }[];
  /** True when either cap clipped the picture — the UI must say so. */
  readonly truncated: boolean;
}

/** The whole visible relation graph for one principal. The contentOverview
 *  scaffolding: read-scoped collections, permissions resolved ONCE, per-
 *  collection authorize() + compiled read filter applied in-query. Edges come
 *  from one access-blind document_index scan and are then intersected against
 *  the visible node set — an item the caller can't read is simply absent, and
 *  every edge touching it disappears with it (never a leak). Only `index: true`
 *  relation fields produce edges (non-indexed relations have no index rows).
 *  `caps` exists for tests; production callers use the defaults. */
export async function graphData(
  db: Database,
  principal: Principal,
  now: string,
  caps: { readonly nodes: number; readonly edges: number } = {
    nodes: GRAPH_MAX_NODES,
    edges: GRAPH_MAX_EDGES,
  },
): Promise<GraphData> {
  const defs = await listCollectionDefs(db);
  const readable = await collectionsWithAction(db, principal, 'read');
  const readableDefs = defs.filter(
    (d) => (readable === '*' || readable.includes(d.slug)) && d.slug !== 'media',
  );

  const permissions = await getPrincipalPermissions(db, principal.id);
  const nodes: GraphNode[] = [];
  const grants: Grant[] = [];
  let truncated = false;

  for (const def of readableDefs) {
    const budget = caps.nodes - nodes.length;
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const resolved: ResolvedAccess = { permissions, publicRead: def.access?.publicRead === true };
    const grant = await authorize(db, principal, 'read', { collection: def.slug }, now, resolved);
    grants.push(grant);
    const rows = await dq.listGraphNodes(
      db,
      {
        collection: def.slug,
        titleFieldKey: titleFieldOf(def),
        accessFilter: await compileReadFilter(db, principal, def.slug, now, resolved),
        limit: budget + 1, // +1: detect clipping without a second count query
      },
      grant,
    );
    if (rows.length > budget) truncated = true;
    for (const r of rows.slice(0, budget)) {
      nodes.push({
        id: r.id,
        collection: def.slug,
        title: typeof r.title === 'string' && r.title.trim() ? r.title : r.id,
        status: r.status === 'draft' && r.publishAt ? 'scheduled' : r.status,
      });
    }
  }

  const pairs: dq.RelationPair[] = [];
  for (const def of readableDefs) {
    for (const f of def.fields) {
      if (f.index && referencesOf(f)) pairs.push({ collection: def.slug, fieldKey: f.key });
    }
  }
  const edgeRows = pairs.length ? await dq.listAllEdges(db, pairs, caps.edges + 1, grants) : [];
  if (edgeRows.length > caps.edges) truncated = true;

  const visible = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = edgeRows
    .slice(0, caps.edges)
    .filter((e) => visible.has(e.sourceId) && visible.has(e.targetId))
    .map((e) => ({
      source: e.sourceId,
      target: e.targetId,
      collection: e.sourceCollection,
      fieldKey: e.fieldKey,
    }));

  return {
    nodes,
    edges,
    collections: readableDefs.map((d) => ({ slug: d.slug, name: d.name })),
    truncated,
  };
}
