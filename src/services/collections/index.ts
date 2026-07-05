/**
 * Collections service — CRUD on content-type definitions. All business logic and
 * authorization live here (steering/CODING_CONVENTIONS.md); routes stay thin.
 * Managing collections requires `manage_schema` (ACCESS_CONTROL.md).
 *
 * A definition is fully validated before it can reach the database: unknown field
 * types, invalid per-field config, reserved/duplicate keys, and index-on-a-
 * non-indexable-type are all rejected here (SCHEMA_ENGINE.md — bad definitions
 * never persist).
 */

import { z } from 'zod';
import type { Database } from '@/db/client';
import type { CollectionDefinition } from '@/fields/types';
import { requireFieldType, isIndexable } from '@/fields/registry';
import * as q from '@/db/queries/collections';
import { authorize, ACTIONS, type Principal } from '@/access';
import { getPrincipalPermissions } from '@/db/queries/roles';
import { InputValidationError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/errors';
import { RESERVED_FIELD_KEYS } from '@/config/constants';
import type { ErrorDetails } from '@/lib/errors';

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const KEY_RE = /^[a-z][a-z0-9_]*$/;

// SEC-6: `access` and `workflow` are persisted verbatim, so they MUST be validated
// before they reach the database. `workflow` is a closed shape; `access` allows the
// `publicRead` sugar plus an optional role→actions map (each value a list of the
// closed action vocabulary).
const WORKFLOW_SCHEMA = z.strictObject({ draftPublish: z.boolean().optional() });
const ACCESS_SCHEMA = z
  .object({ publicRead: z.boolean().optional() })
  .catchall(z.array(z.enum(ACTIONS)));

export const listCollections = q.listCollections;
export const getCollection = q.getCollection;

/** Load a collection by slug or throw `NotFoundError('Collection')`. The shared
 *  form of the `getCollection(...) → if (!def) throw` guard the admin routes each
 *  hand-repeated (TD-5). Returns the FULL definition — use `getCollectionForDiscovery`
 *  for the access-omitting public projection on discovery surfaces. */
export async function getCollectionOrThrow(db: Database, slug: string): Promise<CollectionDefinition> {
  const def = await q.getCollection(db, slug);
  if (!def) throw new NotFoundError('Collection');
  return def;
}

/** Validate + normalize a definition, or throw InputValidationError. */
export function validateDefinition(input: CollectionDefinition): CollectionDefinition {
  const issues: ErrorDetails[] = [];

  if (!SLUG_RE.test(input.slug)) {
    issues.push({ path: 'slug', message: 'Slug must be lowercase, start with a letter (a-z0-9-).' });
  }
  if (!input.name?.trim()) issues.push({ path: 'name', message: 'Name is required.' });
  if (input.shape !== 'collection' && input.shape !== 'singleton') {
    issues.push({ path: 'shape', message: "Shape must be 'collection' or 'singleton'." });
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    issues.push({ path: 'fields', message: 'At least one field is required.' });
  }

  const seen = new Set<string>();
  (input.fields ?? []).forEach((f, i) => {
    const at = `fields[${i}]`;
    if (!KEY_RE.test(f.key ?? '')) {
      issues.push({ path: `${at}.key`, message: `Invalid field key '${f.key}'.` });
    }
    if (RESERVED_FIELD_KEYS.includes(f.key as (typeof RESERVED_FIELD_KEYS)[number])) {
      issues.push({ path: `${at}.key`, message: `'${f.key}' is a reserved key.` });
    }
    if (seen.has(f.key)) issues.push({ path: `${at}.key`, message: `Duplicate field key '${f.key}'.` });
    seen.add(f.key);

    try {
      const ft = requireFieldType(f.type);
      ft.configSchema.parse(f.config ?? {}); // validate per-field config
      if (f.index && !isIndexable(f.type)) {
        issues.push({ path: `${at}.index`, message: `Type '${f.type}' cannot be indexed.` });
      }
      if (f.unique && !f.index) {
        issues.push({ path: `${at}.unique`, message: `A unique field must also be indexed.` });
      }
    } catch (e) {
      if (e instanceof z.ZodError) {
        for (const iss of e.issues) {
          issues.push({ path: `${at}.config.${iss.path.join('.')}`, message: iss.message });
        }
      } else {
        issues.push({ path: `${at}.type`, message: (e as Error).message });
      }
    }
  });

  if (input.workflow !== undefined) {
    const r = WORKFLOW_SCHEMA.safeParse(input.workflow);
    if (!r.success) {
      for (const iss of r.error.issues) {
        issues.push({ path: `workflow${iss.path.length ? `.${iss.path.join('.')}` : ''}`, message: iss.message });
      }
    }
  }
  if (input.access !== undefined) {
    const r = ACCESS_SCHEMA.safeParse(input.access);
    if (!r.success) {
      for (const iss of r.error.issues) {
        issues.push({ path: `access${iss.path.length ? `.${iss.path.join('.')}` : ''}`, message: iss.message });
      }
    }
  }

  if (issues.length) throw new InputValidationError(issues, 'Invalid collection definition');

  return {
    slug: input.slug,
    name: input.name.trim(),
    shape: input.shape,
    fields: input.fields,
    workflow: input.workflow,
    access: input.access,
    protected: input.protected ?? false,
  };
}

export async function createCollection(
  db: Database,
  principal: Principal,
  input: CollectionDefinition,
  now: string,
): Promise<CollectionDefinition> {
  const grant = await authorize(db, principal, 'manage_schema', { collection: input.slug }, now);
  const def = validateDefinition(input);
  if (await q.getCollection(db, def.slug)) {
    throw new ConflictError(`A collection '${def.slug}' already exists.`);
  }
  await q.insertCollection(db, def, now, grant);
  return def;
}

export async function updateCollection(
  db: Database,
  principal: Principal,
  slug: string,
  input: CollectionDefinition,
  now: string,
): Promise<CollectionDefinition> {
  const grant = await authorize(db, principal, 'manage_schema', { collection: slug }, now);
  const existing = await q.getCollection(db, slug);
  if (!existing) throw new NotFoundError('Collection');
  // Protected collections may have fields edited but not their identity changed.
  if (existing.protected && (input.slug !== slug || input.shape !== existing.shape)) {
    throw new ForbiddenError(`Cannot change the slug or shape of protected collection '${slug}'.`);
  }
  const def = validateDefinition({ ...input, slug, protected: existing.protected });
  await q.updateCollectionRow(db, slug, def, now, grant);
  return def;
}

export async function deleteCollection(
  db: Database,
  principal: Principal,
  slug: string,
  now: string,
): Promise<void> {
  const grant = await authorize(db, principal, 'manage_schema', { collection: slug }, now);
  const existing = await q.getCollection(db, slug);
  if (!existing) throw new NotFoundError('Collection');
  if (existing.protected) throw new ForbiddenError(`Collection '${slug}' is protected and cannot be deleted.`);
  await q.deleteCollectionRow(db, slug, grant);
}

// ---------------------------------------------------------------------------
// Public-safe discovery projection (SEC-5)
//
// Collection discovery stays public (remill is agent-native), but an
// UNAUTHENTICATED (or unprivileged) caller must not be able to enumerate the
// internal `access`/`workflow` config. These functions return the FULL definition
// to schema managers and a reduced, public-safe view to everyone else. All three
// discovery surfaces (REST `/api/collections`, MCP `list_collections`, and the
// admin) share this one projection.
// ---------------------------------------------------------------------------

/** A single field as exposed to unauthenticated discovery — no `index`, `unique`,
 *  `config`, `admin`, or `access` internals. */
export interface PublicFieldView {
  readonly key: string;
  readonly type: string;
  readonly label?: string;
  readonly required?: boolean;
}

/** A collection as exposed to unauthenticated discovery — internal `access` and
 *  `workflow` are omitted entirely. */
export interface PublicCollectionView {
  readonly slug: string;
  readonly name: string;
  readonly shape: CollectionDefinition['shape'];
  readonly fields: PublicFieldView[];
}

function toPublicView(def: CollectionDefinition): PublicCollectionView {
  return {
    slug: def.slug,
    name: def.name,
    shape: def.shape,
    fields: def.fields.map((f) => ({
      key: f.key,
      type: f.type,
      ...(f.label ? { label: f.label } : {}),
      ...(f.required ? { required: true } : {}),
    })),
  };
}

/** Whether the principal may see full collection internals. `manage_schema` is the
 *  gate: schema managers author these definitions, so they see them whole. This is
 *  a read-only capability check for projection selection — NOT an authorize()
 *  decision (discovery itself is public), so it is deliberately un-audited. */
async function canSeeInternals(db: Database, principal: Principal): Promise<boolean> {
  const perms = await getPrincipalPermissions(db, principal.id);
  return perms.some((p) => p.action === 'manage_schema');
}

/** List collections for discovery: full definitions for schema managers, the
 *  public-safe projection for everyone else (including anonymous). */
export async function listCollectionsForDiscovery(
  db: Database,
  principal: Principal,
): Promise<CollectionDefinition[] | PublicCollectionView[]> {
  const defs = await q.listCollections(db);
  if (await canSeeInternals(db, principal)) return defs;
  return defs.map(toPublicView);
}

/** Get one collection for discovery, projected per the caller's capability. */
export async function getCollectionForDiscovery(
  db: Database,
  principal: Principal,
  slug: string,
): Promise<CollectionDefinition | PublicCollectionView | null> {
  const def = await q.getCollection(db, slug);
  if (!def) return null;
  if (await canSeeInternals(db, principal)) return def;
  return toPublicView(def);
}
