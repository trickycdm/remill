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
import { resolveField } from '@/fields/registry';
import * as dq from '@/db/queries/documents';
import { getCollection } from '@/db/queries/collections';
import { authorize, compileReadFilter, type Principal } from '@/access';
import { newId } from '@/lib/id';
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

/** Build document_index rows for every indexed field (SCHEMA_ENGINE.md surface 1). */
function buildIndex(def: CollectionDefinition, data: Record<string, unknown>): dq.IndexValue[] {
  const rows: dq.IndexValue[] = [];
  for (const field of def.fields) {
    if (!field.index) continue;
    const { ft } = resolveField(field);
    if (!ft.toIndex) continue;
    const idx = ft.toIndex(data[field.key] as never);
    if (idx === null || idx === undefined) continue;
    rows.push({
      fieldKey: field.key,
      valueText: typeof idx === 'string' ? idx : null,
      valueNum: typeof idx === 'number' ? idx : null,
    });
  }
  return rows;
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
    if (typeof idx !== 'string' || idx === '') continue;
    if (await dq.isIndexValueTaken(db, def.slug, field.key, idx, excludeId)) {
      throw new ConflictError(`${field.label ?? field.key} '${idx}' is already taken.`);
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
  readonly status?: 'draft' | 'published';
  /** Exact-match filters by field key (REST `?filter[field]=`). */
  readonly filters?: Record<string, string>;
  /** Sort by field key + direction (REST `?sort=field` / `?sort=-field`). */
  readonly sort?: { field: string; dir: 'asc' | 'desc' };
}

/** A field must be declared AND indexed to be filtered/sorted on (a 400 per
 *  steering/API_AND_MCP_STANDARDS.md — never silently ignore an unindexed field). */
function assertIndexed(def: CollectionDefinition, fieldKey: string, what: string): void {
  const field = def.fields.find((f) => f.key === fieldKey);
  if (!field || !field.index) {
    throw new BadRequestError(`Field '${fieldKey}' is not indexed; cannot ${what} by it.`);
  }
}

export async function listDocuments(
  db: Database,
  principal: Principal,
  collectionSlug: string,
  params: ListParams,
  now: string,
): Promise<{ rows: DocumentRecord[]; total: number; page: number; pageSize: number }> {
  const grant = await authorize(db, principal, 'read', { collection: collectionSlug }, now);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));

  const filters = Object.entries(params.filters ?? {}).map(([fieldKey, value]) => ({ fieldKey, value }));
  if (filters.length || params.sort) {
    const def = await loadCollection(db, collectionSlug);
    for (const f of filters) assertIndexed(def, f.fieldKey, 'filter');
    if (params.sort) assertIndexed(def, params.sort.field, 'sort');
  }

  const { rows, total } = await dq.listDocuments(
    db,
    collectionSlug,
    {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      status: params.status,
      accessFilter: await compileReadFilter(db, principal, collectionSlug, now),
      filters,
      sort: params.sort ? { fieldKey: params.sort.field, dir: params.sort.dir } : undefined,
    },
    grant,
  );
  return { rows, total, page, pageSize };
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
  await dq.insertDocument(
    db,
    {
      id,
      collection: collectionSlug,
      data,
      status,
      createdBy: principal.id,
      now,
      publishedAt: status === 'published' ? now : null,
      index: buildIndex(def, data),
    },
    grant,
  );
  return (await dq.getDocument(db, collectionSlug, id, grant))!;
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
  // the full merged document.
  const merged = { ...existing.data, ...whitelistOnly(def, input) };
  const validated = whitelistAndValidate(def, merged);
  const data = await runTransforms(def, validated, principal.id, now, false);
  await checkUnique(db, def, data, id);

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
  return (await dq.getDocument(db, collectionSlug, id, grant))!;
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
  await dq.updateDocument(
    db,
    {
      id,
      collection: collectionSlug,
      data: existing.data,
      status,
      savedBy: principal.id,
      now,
      publishedAt: publish ? (existing.publishedAt ?? now) : null,
      revision: await dq.nextRevisionNumber(db, id),
      index: buildIndex(def, existing.data),
    },
    grant,
  );
  return (await dq.getDocument(db, collectionSlug, id, grant))!;
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
