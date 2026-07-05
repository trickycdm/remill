# Schema Engine

> **STATUS: IMPLEMENTED (Phase 2 + Track B).** The registry + 11 field types live in `src/fields/`; the collections
> and documents services in `src/services/`; the witnessed queries in `src/db/queries/`. Surfaces 3–4
> (admin UI) are composed by the generated admin (Phase 4); surfaces 5–6 (REST/MCP) by Phases 6–7 —
> the field types already expose the `EditComponent`/`CellComponent`/`jsonSchema` those phases consume.
> This is the constitution of the codebase. Every feature surface is generated from the definitions
> described here. If a feature can't be generated from the collection definition, question whether it belongs.

## The invariant

**One collection definition generates six surfaces:**

1. **Storage** — document persistence + `document_index` rows for query/sort
2. **Validation** — a Zod validator built at runtime from field descriptors
3. **Admin list view** — columns, cell renderers, sort/filter
4. **Admin edit form** — composed field edit components
5. **REST API** — endpoints + OpenAPI schemas
6. **MCP tools** — per-collection tools with JSON Schema inputs

A change that serves one surface but breaks generation for another is wrong. Review any change to the
FieldType contract against all six surfaces before merging.

## Collections are data; field types are code

- **Field types** live in code: `src/fields/`, one module per type, registered in `src/fields/registry.ts`.
  Adding a field type is a code change (it ships validation logic and UI components).
- **Collections** live in the database: rows in `collections` with `fields_json` composing field types
  declaratively. Adding/changing a content type is a runtime operation (admin UI or MCP) — no deploy.
- Per-collection **arbitrary-code hooks are banned** in v1. Common behaviors are declarative flags:
  `workflow.draftPublish`, slug config (`{ from: "title" }`), timestamps. If a behavior needs code,
  it belongs in a field type or the engine — never in collection data.
- **Lifecycle modes (B4).** `workflow` has three states: `{draftPublish: true}` (authored content —
  born draft, explicit publish step), absent/default (born published, publish/unpublish available),
  and `{lifecycle: 'none'}` (record-like data — born published, and the status column, status
  filter, publish button, `publish_<slug>` tool, and OpenAPI publish path are ALL suppressed;
  `setPublished` 400s). This is a **visibility opt-out, not a status removal**: `documents.status`
  stays load-bearing in the access layer (the `published` condition, publicRead sugar), which is
  exactly why lifecycle-none docs must be born published. Gate on `hasLifecycle(def)`
  (`src/lib/lifecycle.ts`) — never re-derive the rule. `none` + `draftPublish` is rejected on write.

## The FieldType contract

```ts
interface FieldType<Config, Value> {
  key: string                    // 'text' | 'markdown' | 'number' | 'boolean' | 'datetime'
                                 // | 'select' | 'media' | 'tags' | 'slug' | 'json' | 'relation'
  configSchema: ZodType<Config>  // validates per-field options stored in fields_json
  valueSchema: (cfg: Config) => ZodType<Value>   // (2) one validator for ALL surfaces
  toIndex?: (v: Value) =>                        // (1) promoted to document_index for query/sort;
    string | number |                            //     an ARRAY return emits one row PER ELEMENT
    ReadonlyArray<string | number> | null        //     (multi-valued fields, e.g. multi-relation)
  multiValued?: (cfg: Config) => boolean         // declares the array-return case for this config
  beforeSave?: (v: Value, ctx: SaveCtx) => Value | Promise<Value>
  beforeRender?: (v: Value, ctx: RenderCtx) => unknown | Promise<unknown>
  EditComponent: FC<FieldEditProps<Config, Value>>   // (4) Datastar-wired form widget
  CellComponent?: FC<FieldCellProps<Value>>          // (3) list-view cell (fallback: text render)
  jsonSchema: (cfg: Config) => JSONSchema            // (5) OpenAPI + (6) MCP input schemas
}
```

Rules:
- A field type **must** implement every non-optional member. No partial types.
- `valueSchema` is the single source of validation truth. Admin, REST, and MCP all run the same
  Zod validator. Never add surface-specific validation.
- `toIndex` returns a scalar, an array, or null. Omit it for types that can't be meaningfully
  sorted/filtered (e.g. `json`); such fields cannot set `"index": true`.
- **Multi-valued indexing:** a type whose `toIndex` may return an array MUST declare it via
  `multiValued(cfg)`. The engine writes one `document_index` row per element (each independently
  filterable — filter matches ANY element — and reverse-lookupable for backlinks), and enforces
  two guards: a multi-valued field **cannot be `unique`** (its rows share one `unique_key`, so two
  docs sharing any element would falsely collide — rejected at definition time) and **cannot be
  sorted on** (the sort subquery would pick an arbitrary row — rejected with a 400 at query time).
- **`relation`** (`src/fields/relation.tsx`) is the graph-edge type: config
  `{ collection, multiple?, titleField? }`, value = `doc_…` id (or id array when `multiple`).
  Validation is FORMAT-ONLY (media precedent) — target existence resolves on read, so a dangling
  reference degrades gracefully rather than blocking saves.
- Transforms (`beforeSave`/`beforeRender`) must be pure with respect to the context given — no
  reaching into globals, no direct DB access. They receive what they need via ctx.
- Field-level access control is **deferred post-v1**, but the hook point is reserved: a field
  descriptor may carry `access: { read?: string[]; write?: string[] }` — currently ignored by the
  engine, never repurposed for anything else.

## The collection definition (stored in D1 `collections.fields_json`)

```jsonc
{
  "slug": "posts",
  "name": "Posts",
  "shape": "collection",            // or "singleton"
  "fields": [
    { "key": "title",  "type": "text",      "required": true, "index": true,
      "admin": { "showInList": true } },
    { "key": "slug",   "type": "slug",      "config": { "from": "title" }, "unique": true },
    { "key": "body",   "type": "markdown" },
    { "key": "hero",   "type": "media",     "config": { "kinds": ["image"] } },
    { "key": "tags",   "type": "tags",      "index": true }
  ],
  "workflow": { "draftPublish": true },     // declarative behaviors, not code hooks
  "access": { "publicRead": true }          // sugar: anonymous may read published docs
}
```

- Field `key`s must be unique per collection, `^[a-z][a-z0-9_]*$`, and must not collide with
  engine-reserved keys (`id`, `status`, `createdAt`, `updatedAt`, `publishedAt`, `createdBy`).
- `config` is validated by the field type's `configSchema` when the collection is saved. A
  collection definition with an unknown `type` or invalid `config` is rejected — bad definitions
  never reach the database.
- `shape: "singleton"` collections hold exactly one document; the engine auto-creates it on first
  read and list/create/delete surfaces are not generated for them.

## The save pipeline (every surface, no exceptions)

On every document write — admin, REST, or MCP:

1. Load the collection definition.
2. Build the Zod validator from field types.
3. Validate **only declared fields** — a strict whitelist. Undeclared keys in the payload are
   rejected (not stripped silently — reject, so agents learn the schema). **This is the direct fix
   for Blogmill's mass-assignment hole. Never bypass it.**
4. Run `beforeSave` transforms in field order.
5. `authorize()` has already gated the service call (see ACCESS_CONTROL.md) — writes are attributed
   to a principal.
6. Write the document (`data_json`), sync `document_index` rows, and append a `document_revisions`
   row — atomically via `db.batch()`.

## Schema edits vs existing documents (v1 policy)

When a field is removed or retyped after content exists: old values **persist** in `data_json`,
are **hidden** when undeclared (whitelist strips them at render), and their index rows are dropped
on the document's next save. **Never destructively migrate content.** State-changing schema
migrations are a post-v1 feature with their own design.

## Built-in collections (dogfooding)

`settings` (singleton) and `media` metadata ride the schema engine as seeded, **protected**
collections (cannot be deleted; slugs reserved). If the engine can't express its own system needs,
the engine is not good enough — fix the engine, don't special-case.

## How to add a field type

1. Create `src/fields/<key>.ts` exporting a `FieldType` object (full contract).
2. Register it in `src/fields/registry.ts`.
3. Add a round-trip unit test: config → validator → save → index → render.
4. Add its `EditComponent`/`CellComponent` and a Playwright interaction test if it has any
   Datastar-reactive behavior.
5. Update this doc's key list.

No other file should need to change — if one does, the registry has a leak; fix the registry.
