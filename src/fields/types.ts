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
  /** Declarative behaviors. `draftPublish` starts docs as drafts with an explicit
   *  publish step; `lifecycle: 'none'` opts OUT of the publish lifecycle entirely
   *  (docs born published, status affordances suppressed — record-like data).
   *  The two are contradictory together and rejected on write. */
  readonly workflow?: { readonly draftPublish?: boolean; readonly lifecycle?: 'publish' | 'none' };
  // The TWO collection-level access knobs, mutually exclusive (rejected together
  // on write). `publicRead` lets anyone read published documents. `private`
  // (D46) removes the collection from every DISCOVERY surface — REST/MCP
  // collection list+get, OpenAPI paths, pack installed-status — for principals
  // without `manage_schema` or a role/token-scope `read` on it (item grants
  // deliberately don't confer discovery, matching MCP tool visibility). Content
  // access is untouched: documents were already deny-by-default. Collection-
  // scoped permissions live in `role_permissions` (the authorizer's single
  // source); an inline role→action map is rejected on write (collections service).
  readonly access?: { readonly publicRead?: boolean; readonly private?: boolean };
  /** How the public routes render documents (D27). Default/absent = 'shell'
   *  (branded PublicShell). 'raw' = the collection's FIRST `html` field IS the
   *  page — returned as a full standalone document (no shell, no design-system
   *  CSS); requires at least one html field; an empty value falls back to the
   *  shell so a published page is never blank. */
  readonly renderMode?: 'shell' | 'raw';
  /** Selects a reading TEMPLATE from the registry (src/templates/) for the public
   *  page — the code side of the render surface (templates are code; this key is
   *  data). Absent ⇒ the generic DocumentView shell; `renderMode: 'raw'` still
   *  wins over any template. Validated against the registry on write. */
  readonly template?: string;
  /** Explicit render bindings for the templates' scalar slots — the escape
   *  hatch when convention guesses wrong (e.g. an `author` text field would
   *  win the lead slot). Values are field keys; validated on write (existing
   *  key, slot-appropriate type: title/lead → text, hero → media). Convention
   *  resolves any slot left unbound. `bind.title` also drives titleFieldOf, so
   *  H1, OG/feeds, search, and relation titles stay unified. */
  readonly bind?: { readonly title?: string; readonly hero?: string; readonly lead?: string };
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

/** What a referencing field's id(s) resolved to on the read path (B2): the
 *  target's display title (null when dangling, unreadable, or untitled) plus
 *  where it lives. Attached BESIDE data, never inside it — data keeps raw ids. */
export interface ExpandedReference {
  readonly id: string;
  readonly title: string | null;
  readonly collection: string;
}

/** Display metadata for a `media` field value, resolved on the read path from the
 *  `media` table and attached BESIDE data (the relation-expansion posture, B2).
 *  Lets the media ViewComponent render real alt text + intrinsic dimensions
 *  instead of a blank alt (C1). */
export interface MediaMeta {
  readonly id: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface FieldCellProps<Config = unknown, Value = unknown> {
  readonly value: Value | undefined;
  /** The field's validated config — lets a cell render human labels (e.g. a
   *  `select`'s option label) rather than the raw stored value. */
  readonly config: Config;
  /** The read path's expansion of a referencing field's value, when available
   *  (list rows carry it; contexts without it fall back to the raw value). */
  readonly expanded?: ExpandedReference | readonly ExpandedReference[];
}

/** Props for the read-only render seam (C1): the admin detail view and the
 *  public pages. `surface` lets a type route links appropriately (admin URLs
 *  vs public URLs); `expanded` carries the read path's relation expansion. */
export interface FieldViewProps<Config = unknown, Value = unknown> {
  readonly field: FieldDescriptor;
  readonly config: Config;
  readonly value: Value | undefined;
  readonly expanded?: ExpandedReference | readonly ExpandedReference[];
  /** The read path's media-table expansion for THIS field's value, when the field
   *  is a `media` type and the record resolved (else undefined). */
  readonly media?: MediaMeta;
  readonly surface: 'admin' | 'public';
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

  /** (1b) FULL plain text for the FTS5 search index (D28) — unlike `toIndex`,
   *  which may truncate (markdown/html store a 200-char lead-in), this returns
   *  the complete searchable text. Omitted ⇒ the engine falls back to the
   *  field's `toIndex` string output (nothing for non-text values). */
  readonly toSearchText?: (v: Value) => string | null;

  /** Whether this field indexes as multi-valued under `cfg` (its `toIndex` may
   *  return an array). Multi-valued fields cannot be `unique` (all rows would
   *  share one unique_key → false collisions) and cannot be sorted on (the sort
   *  subquery would pick an arbitrary row) — both enforced by the engine.
   *  Omit for always-scalar types. */
  readonly multiValued?: (cfg: Config) => boolean;

  /** Declares that this field's value REFERENCES documents in another collection
   *  (a `doc_…` id or id array). The documents read path batch-expands references
   *  into `ExpandedReference`s attached beside data (B2). Return null when a
   *  given config doesn't reference anything. Omit for non-referencing types. */
  readonly references?: (cfg: Config) => { collection: string; titleField?: string } | null;

  /** transforms — Blogmill's fieldPreSave / preFieldRender, reborn. */
  readonly beforeSave?: (v: Value, ctx: SaveCtx) => Value | Promise<Value>;
  readonly beforeRender?: (v: Value, ctx: RenderCtx) => unknown | Promise<unknown>;

  /** (4) edit widget (Datastar-wired) and (3) list cell (optional; falls back
   *  to a text render). Composed by the generated admin (Phase 4). */
  readonly EditComponent: FC<FieldEditProps<Config, Value>>;
  readonly CellComponent?: FC<FieldCellProps<Config, Value>>;

  /** Read-only render for detail/public surfaces (C1, D23). OPTIONAL — the
   *  engine's default is safe escaped text, so a type renders rich output only
   *  by explicitly opting in (markdown → sanitized HTML, relation → title link,
   *  media → <img>). Composed by FieldView (src/components/field-view.tsx). */
  readonly ViewComponent?: FC<FieldViewProps<Config, Value>>;

  /** (5) OpenAPI + (6) MCP input schema. Defaults to deriving from valueSchema
   *  via Zod's toJSONSchema when omitted (see registry.deriveJsonSchema). */
  readonly jsonSchema?: (cfg: Config, field: FieldDescriptor) => JSONSchema;
}

/** Existential field type for storing heterogeneous types in the registry.
 *  `<never, never>` is an intentional type-erasure seam (TD-13): the registry
 *  holds many concrete `FieldType<C, V>` under one key-map type, so callers erase
 *  Config/Value here and re-narrow at each resolved use site (see registry.ts). */
export type AnyFieldType = FieldType<never, never>;
