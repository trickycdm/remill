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
import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';
import { requireFieldType, isIndexable, isMultiValued } from '@/fields/registry';
import * as q from '@/db/queries/collections';
import { authorize, type Principal } from '@/access';
import { getPrincipalPermissions } from '@/db/queries/roles';
import { InputValidationError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/errors';
import { RESERVED_FIELD_KEYS, RESERVED_COLLECTION_SLUGS } from '@/config/constants';
import { TEMPLATE_KEYS, isTemplateKey } from '@/templates/keys';
import type { ErrorDetails } from '@/lib/errors';

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const KEY_RE = /^[a-z][a-z0-9_]*$/;

// SEC-6: `access` and `workflow` are persisted verbatim, so they MUST be validated
// before they reach the database. Both are CLOSED shapes. `access` carries ONLY the
// `publicRead` sugar — collection-scoped permissions live in `role_permissions`
// (`principal_roles` assignments scoped to a collection), the single mechanism the
// authorizer actually consumes. An earlier `.catchall(role→actions)` map was accepted,
// stored, and silently ignored by `decide()` — a security smell (it looked like it
// granted access but did nothing). It is now rejected outright (strictObject).
const WORKFLOW_SCHEMA = z.strictObject({
  draftPublish: z.boolean().optional(),
  // 'none' opts the collection OUT of the publish lifecycle (B4): docs are born
  // published and the status affordances are suppressed on every surface.
  lifecycle: z.enum(['publish', 'none']).optional(),
});
const ACCESS_SCHEMA = z.strictObject({ publicRead: z.boolean().optional() });
// Explicit render bindings (templates' escape hatch when convention would guess
// wrong). CLOSED shape like workflow/access; slot-appropriate field types are
// checked below against the actual field list.
const BIND_SCHEMA = z.strictObject({
  title: z.string().optional(),
  hero: z.string().optional(),
  lead: z.string().optional(),
});
const BIND_SLOT_TYPES = { title: ['text'], hero: ['media'], lead: ['text'] } as const;

export const listCollections = q.listCollections;
export const getCollection = q.getCollection;

/** Load a collection by slug or throw `NotFoundError('Collection')`. The shared
 *  form of the `getCollection(...) → if (!def) throw` guard the admin routes each
 *  hand-repeated (TD-5). Returns the FULL definition — use `getCollectionForDiscovery`
 *  for the access-omitting public projection on discovery surfaces. */
export async function getCollectionOrThrow(
  db: Database,
  slug: string,
): Promise<CollectionDefinition> {
  const def = await q.getCollection(db, slug);
  if (!def) throw new NotFoundError('Collection');
  return def;
}

/**
 * Field-level normalization applied before validation. A `slug` field's whole
 * purpose is the pretty URL — which the public route (`getDocumentBySlug`) and
 * the feeds/canonical (`publicUrlOf`) resolve through the index. An un-indexed
 * slug silently 404s and drops out of RSS/sitemap/OG, so default it to indexed
 * unless the definition explicitly opts out (`index: false`). Relations still
 * opt in explicitly: indexing one powers backlinks + relation filters, but
 * carries a per-edge write cost the author should choose deliberately.
 */
function withFieldDefaults(f: FieldDescriptor): FieldDescriptor {
  if (f.type === 'slug' && f.index === undefined) return { ...f, index: true };
  return f;
}

/** Validate + normalize a definition, or throw InputValidationError. */
export function validateDefinition(input: CollectionDefinition): CollectionDefinition {
  const issues: ErrorDetails[] = [];
  const fields = Array.isArray(input.fields) ? input.fields.map(withFieldDefaults) : [];

  if (!SLUG_RE.test(input.slug)) {
    issues.push({
      path: 'slug',
      message: 'Slug must be lowercase, start with a letter (a-z0-9-).',
    });
  }
  // A collection named after a static top-level route would be shadowed on the
  // public surface (C2) — reject up front rather than 404 mysteriously later.
  if ((RESERVED_COLLECTION_SLUGS as readonly string[]).includes(input.slug)) {
    issues.push({ path: 'slug', message: `'${input.slug}' is a reserved path segment.` });
  }
  if (!input.name?.trim()) issues.push({ path: 'name', message: 'Name is required.' });
  if (input.shape !== 'collection' && input.shape !== 'singleton') {
    issues.push({ path: 'shape', message: "Shape must be 'collection' or 'singleton'." });
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    issues.push({ path: 'fields', message: 'At least one field is required.' });
  }

  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const at = `fields[${i}]`;
    if (!KEY_RE.test(f.key ?? '')) {
      issues.push({ path: `${at}.key`, message: `Invalid field key '${f.key}'.` });
    }
    if (RESERVED_FIELD_KEYS.includes(f.key as (typeof RESERVED_FIELD_KEYS)[number])) {
      issues.push({ path: `${at}.key`, message: `'${f.key}' is a reserved key.` });
    }
    if (seen.has(f.key))
      issues.push({ path: `${at}.key`, message: `Duplicate field key '${f.key}'.` });
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
      // A multi-valued field writes N index rows sharing one unique_key — two docs
      // sharing ANY element would falsely collide. Reject at definition time.
      if (f.unique && isMultiValued(f)) {
        issues.push({ path: `${at}.unique`, message: `A multi-valued field cannot be unique.` });
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
        issues.push({
          path: `workflow${iss.path.length ? `.${iss.path.join('.')}` : ''}`,
          message: iss.message,
        });
      }
    } else if (r.data.lifecycle === 'none' && r.data.draftPublish) {
      issues.push({
        path: 'workflow',
        message: "lifecycle 'none' and draftPublish are contradictory — pick one.",
      });
    }
  }
  if (input.access !== undefined) {
    const r = ACCESS_SCHEMA.safeParse(input.access);
    if (!r.success) {
      for (const iss of r.error.issues) {
        issues.push({
          path: `access${iss.path.length ? `.${iss.path.join('.')}` : ''}`,
          message: iss.message,
        });
      }
    }
  }
  if (input.renderMode !== undefined) {
    if (input.renderMode !== 'shell' && input.renderMode !== 'raw') {
      issues.push({ path: 'renderMode', message: "renderMode must be 'shell' or 'raw'." });
    } else if (input.renderMode === 'raw' && !(input.fields ?? []).some((f) => f.type === 'html')) {
      // In raw mode the FIRST html field IS the page (D27) — without one there
      // is nothing to render.
      issues.push({
        path: 'renderMode',
        message: "renderMode 'raw' requires at least one 'html' field.",
      });
    }
  }
  // The `template` selector must name a REGISTERED reading template (src/templates/).
  // Closed set, rejected on write (SEC-6) — an unknown key would silently fall back
  // to the shell, so fail loudly instead.
  if (input.template !== undefined && input.template !== null && !isTemplateKey(input.template)) {
    issues.push({
      path: 'template',
      message: `template must be one of: ${TEMPLATE_KEYS.join(', ')}.`,
    });
  }
  // `bind` pins template slots to fields explicitly. Same loud-rejection posture:
  // a binding to a missing or wrong-typed field would render silently wrong
  // (a text field as a hero image), so fail on write instead.
  if (input.bind !== undefined && input.bind !== null) {
    const r = BIND_SCHEMA.safeParse(input.bind);
    if (!r.success) {
      for (const iss of r.error.issues) {
        issues.push({
          path: `bind${iss.path.length ? `.${iss.path.join('.')}` : ''}`,
          message: iss.message,
        });
      }
    } else {
      for (const [slot, allowed] of Object.entries(BIND_SLOT_TYPES)) {
        const key = r.data[slot as keyof typeof BIND_SLOT_TYPES];
        if (key === undefined) continue;
        const target = fields.find((f) => f.key === key);
        if (!target) {
          issues.push({ path: `bind.${slot}`, message: `bind.${slot} names no field '${key}'.` });
        } else if (!(allowed as readonly string[]).includes(target.type)) {
          issues.push({
            path: `bind.${slot}`,
            message: `bind.${slot} must name a ${allowed.join('/')} field, '${key}' is '${target.type}'.`,
          });
        }
      }
      const bound = Object.values(r.data).filter((v): v is string => typeof v === 'string');
      if (new Set(bound).size !== bound.length) {
        issues.push({ path: 'bind', message: 'bind slots must name distinct fields.' });
      }
    }
  }

  if (issues.length) throw new InputValidationError(issues, 'Invalid collection definition');

  return {
    slug: input.slug,
    name: input.name.trim(),
    shape: input.shape,
    fields,
    workflow: input.workflow,
    access: input.access,
    renderMode: input.renderMode,
    template: input.template ?? undefined,
    bind: input.bind ?? undefined,
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
  await q.insertCollection(db, def, now, grant, {
    type: 'collection.created',
    collection: def.slug,
    resource: def.slug,
    principalId: principal.id,
    at: now,
  });
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
  await q.updateCollectionRow(db, slug, def, now, grant, {
    type: 'collection.updated',
    collection: slug,
    resource: slug,
    principalId: principal.id,
    at: now,
  });
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
  if (existing.protected)
    throw new ForbiddenError(`Collection '${slug}' is protected and cannot be deleted.`);
  await q.deleteCollectionRow(db, slug, grant, {
    type: 'collection.deleted',
    collection: slug,
    resource: slug,
    principalId: principal.id,
    at: now,
  });
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
