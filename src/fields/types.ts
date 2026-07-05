/**
 * The FieldType contract — the most important interface in the codebase
 * (steering/SCHEMA_ENGINE.md). One field-type module drives all six surfaces:
 * (1) storage/index, (2) validation, (3) list cell, (4) edit widget,
 * (5) REST/OpenAPI schema, (6) MCP input schema.
 *
 * Field TYPES are code (this registry). COLLECTIONS are data (rows in D1 whose
 * fields_json composes these types). See SCHEMA_ENGINE.md.
 */

import type { ZodType } from 'zod';
import type { FC } from 'hono/jsx';

/** A JSON Schema object (draft 2020-12) — surfaces 5 & 6. Loose by design. */
export type JSONSchema = Record<string, unknown>;

/** Optional per-field access hook point — RESERVED, ignored by the engine in v1
 *  (field-level access is deferred post-v1; never repurpose — SCHEMA_ENGINE.md). */
export interface FieldAccess {
  readonly read?: readonly string[];
  readonly write?: readonly string[];
}

/** Admin display hints for a field. */
export interface FieldAdmin {
  readonly showInList?: boolean;
  readonly help?: string;
  readonly placeholder?: string;
}

/** One field in a collection definition (a row inside `fields_json`). */
export interface FieldDescriptor {
  readonly key: string;
  readonly type: string; // a registered FieldType.key
  readonly label?: string;
  readonly required?: boolean;
  readonly index?: boolean; // promote to document_index for query/sort/filter
  readonly unique?: boolean; // uniqueness enforced on save (e.g. slug)
  readonly config?: unknown; // validated by the field type's configSchema
  readonly admin?: FieldAdmin;
  readonly access?: FieldAccess; // reserved, ignored in v1
}

export type CollectionShape = 'collection' | 'singleton';

/** A collection definition — the data that drives everything (SCHEMA_ENGINE.md). */
export interface CollectionDefinition {
  readonly slug: string;
  readonly name: string;
  readonly shape: CollectionShape;
  readonly fields: readonly FieldDescriptor[];
  readonly workflow?: { readonly draftPublish?: boolean };
  // `publicRead` is the ONLY collection-level access knob. Collection-scoped
  // permissions live in `role_permissions` (the authorizer's single source);
  // an inline role→action map is rejected on write (see collections service).
  readonly access?: { readonly publicRead?: boolean };
  readonly protected?: boolean;
}

/** Context handed to `beforeSave` transforms. Pure w.r.t. what it's given —
 *  transforms must not reach into globals or the DB (SCHEMA_ENGINE.md). */
export interface SaveCtx {
  readonly field: FieldDescriptor;
  readonly collection: CollectionDefinition;
  /** The full incoming (already whitelisted) document data, read-only. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly principalId: string;
  readonly now: string; // ISO timestamp, injected (Workers-safe determinism)
  /** True when creating; false on update. */
  readonly isCreate: boolean;
}

/** Context handed to `beforeRender` transforms. */
export interface RenderCtx {
  readonly field: FieldDescriptor;
  readonly collection: CollectionDefinition;
  readonly surface: 'admin' | 'rest' | 'mcp';
}

export interface FieldEditProps<Config = unknown, Value = unknown> {
  readonly field: FieldDescriptor;
  readonly config: Config;
  readonly value: Value | undefined;
  /** kebab-case Datastar signal key bound to this field (DATASTAR_PATTERNS.md). */
  readonly signal: string;
}

export interface FieldCellProps<Config = unknown, Value = unknown> {
  readonly value: Value | undefined;
  /** The field's validated config — lets a cell render human labels (e.g. a
   *  `select`'s option label) rather than the raw stored value. */
  readonly config: Config;
}

/**
 * The field-type contract. Every module in src/fields/ exports one of these.
 * `Config` = the shape of the per-field `config`; `Value` = the stored value.
 */
export interface FieldType<Config = unknown, Value = unknown> {
  /** Discriminator, unique in the registry ('text' | 'markdown' | …). */
  readonly key: string;

  /** (config) validates the per-field options in fields_json. */
  readonly configSchema: ZodType<Config>;

  /** (2) validation — the single validator all surfaces run. Returns a schema
   *  whose output is `Value` (or `undefined` for an optional field), so the
   *  return type is the permissive `ZodType<unknown>`; `Value` documents the
   *  stored shape that toIndex/beforeSave/components see. */
  readonly valueSchema: (cfg: Config, field: FieldDescriptor) => ZodType<unknown>;

  /** (1) value promoted into document_index for query/sort. Omit for
   *  non-indexable types (e.g. json) — such fields may not set index:true.
   *  Returning an ARRAY emits one index row per element (multi-valued fields,
   *  e.g. a multi-`relation` — each element independently filterable and
   *  reverse-lookupable); scalar returns emit a single row as before. */
  readonly toIndex?: (v: Value) => string | number | ReadonlyArray<string | number> | null;

  /** Whether this field indexes as multi-valued under `cfg` (its `toIndex` may
   *  return an array). Multi-valued fields cannot be `unique` (all rows would
   *  share one unique_key → false collisions) and cannot be sorted on (the sort
   *  subquery would pick an arbitrary row) — both enforced by the engine.
   *  Omit for always-scalar types. */
  readonly multiValued?: (cfg: Config) => boolean;

  /** transforms — Blogmill's fieldPreSave / preFieldRender, reborn. */
  readonly beforeSave?: (v: Value, ctx: SaveCtx) => Value | Promise<Value>;
  readonly beforeRender?: (v: Value, ctx: RenderCtx) => unknown | Promise<unknown>;

  /** (4) edit widget (Datastar-wired) and (3) list cell (optional; falls back
   *  to a text render). Composed by the generated admin (Phase 4). */
  readonly EditComponent: FC<FieldEditProps<Config, Value>>;
  readonly CellComponent?: FC<FieldCellProps<Config, Value>>;

  /** (5) OpenAPI + (6) MCP input schema. Defaults to deriving from valueSchema
   *  via Zod's toJSONSchema when omitted (see registry.deriveJsonSchema). */
  readonly jsonSchema?: (cfg: Config, field: FieldDescriptor) => JSONSchema;
}

/** Existential field type for storing heterogeneous types in the registry.
 *  `<never, never>` is an intentional type-erasure seam (TD-13): the registry
 *  holds many concrete `FieldType<C, V>` under one key-map type, so callers erase
 *  Config/Value here and re-narrow at each resolved use site (see registry.ts). */
export type AnyFieldType = FieldType<never, never>;
