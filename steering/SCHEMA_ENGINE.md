# Schema Engine

> **STATUS: IMPLEMENTED (Phase 2 + Track B; sharing fabric v2 added `html` + `renderMode`, D25/D27).**
> The registry + 12 field types live in `src/fields/`; the collections
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
- **Declarative flags live behind CLOSED Zod shapes.** `workflow` and `access` are validated by
  `strictObject`s in the collections service (SEC-6) — a NEW flag is **rejected on write** until
  `WORKFLOW_SCHEMA`/`ACCESS_SCHEMA` (and the `CollectionDefinition` type) are extended first. That
  extension is step one of adding any flag, not an afterthought (B4 precedent). `access` carries two
  mutually-exclusive flags: `publicRead` (anonymous read of published docs) and `private` (D46 —
  hide the collection from every discovery surface for principals without `manage_schema` or a
  role/scope read; see ACCESS_CONTROL.md).
- **Lifecycle modes (B4).** `workflow` has three states: `{draftPublish: true}` (authored content —
  born draft, explicit publish step), absent/default (born published, publish/unpublish available),
  and `{lifecycle: 'none'}` (record-like data — born published, and the status column, status
  filter, publish button, `publish_<slug>` tool, and OpenAPI publish path are ALL suppressed;
  `setPublished` 400s). This is a **visibility opt-out, not a status removal**: `documents.status`
  stays load-bearing in the access layer (the `published` condition, publicRead sugar), which is
  exactly why lifecycle-none docs must be born published. Gate on `hasLifecycle(def)`
  (`src/lib/lifecycle.ts`) — never re-derive the rule. `none` + `draftPublish` is rejected on write.
- **Render mode (D27).** `renderMode: 'shell' | 'raw'` picks the public render for the collection:
  `shell` (default) wraps `document-view` in the public shell; `raw` serves the **first** `html`
  field's value verbatim as the whole page (`rawPageHtml(def, doc)`, bypassing the layout) on
  `/:collection/:slug` and `/s/:token` alike. Validated on write — `raw` requires at least one
  `html` field — and an empty value falls back to shell rendering.
- **Render template (D41).** Beside `renderMode`, an optional `template` key selects a purpose-built
  READING layout from the registry (`src/templates/`) for the shell-rendered public page — the code
  side of the render surface (templates are CODE; the key is DATA — the field-registry grain applied
  to rendering). Resolved BEFORE the generic `DocumentView` fallback (`renderMode: 'raw'` still wins),
  rendered inside PublicShell. Validated against the registry on write (unknown key rejected — SEC-6).
  The shipped `article` template binds fields by CONVENTION (`resolveConventionLayout`: first media =
  hero, first non-title text = dek, markdown = body, tags/relations = meta, slug never rendered) —
  presentation lives in code, NEVER as a per-field role in the schema data. See TECH_DECISIONS D41.
- **Text renders (D47).** Beside the HTML templates, a template key can declare named TEXT renders
  (`src/templates/renders.ts` — pure, import-light, no JSX): role-tailored, token-budgeted markdown
  views of a document (the `warp` template ships `reviewer`/`implementer`). A derived surface riding
  the existing `read` action — exposed as `render`/`budget` args on generated `get_<slug>` MCP tools
  and `?render=` on the REST document GET, advertised ONLY where the template declares renders (the
  enum derives from code, so schema drift is impossible). Tailoring is by ROLE + BUDGET, never model
  vendor. The `renderDocumentText` service validates the render name against code metadata BEFORE the
  document read (no existence oracle). See TECH_DECISIONS D47.
- **Explicit slot binding (`bind`, D42).** When convention would guess wrong (an `author` text field
  winning the dek slot), the optional `bind` key pins the scalar slots explicitly:
  `{ title?, hero?, lead? }` → field keys. CLOSED shape (strictObject, the workflow/access posture);
  each slot must name an existing field of the slot-appropriate type (title/lead → text, hero →
  media), distinct per slot — rejected loudly on write. `bind.title` flows through `titleFieldOf`,
  so the H1, OG/feeds, search title, and relation titles stay ONE heuristic. Convention resolves
  any slot left unbound. Stored in `collections.bind_json` (migration 0013).
- **SEO convention keys (D52).** `buildDocumentHead` (`src/lib/seo.ts`) resolves the rich public
  head — title, description, social image — from three optional convention field KEYS, same
  pattern as `bind`: `seo_title` (text — overrides `titleOf` in `<title>`/`og:title`),
  `meta_description` (text, ≤160 chars — overrides the resolved lead/excerpt in the description
  meta and `og:description`), `social_image` (media — overrides the resolved hero in `og:image`).
  Snake_case, matching the field-key charset (`KEY_RE` rejects camelCase). Present on the blog,
  docs, and portfolio packs' collection definitions; addable to any collection in the builder —
  the convention resolver picks them up by key, no schema change needed. Each falls back through
  the same convention chain used for the reading template (`bind.lead`/`bind.hero` honoured first)
  before a site-level `settings` default.
- **Content packs (D42).** A pack (`src/templates/packs.ts`, closed registry) bundles a template with
  the collection definition(s) co-designed for it. Installing (admin Marketplace, MCP `install_pack`,
  REST) runs each definition through the ordinary `createCollection` — packs add ZERO bypass surface:
  same validation, same authorize, same outbox event.

## The FieldType contract

```ts
interface FieldType<Config, Value> {
  key: string                    // 'text' | 'markdown' | 'number' | 'boolean' | 'datetime'
                                 // | 'select' | 'media' | 'tags' | 'slug' | 'json' | 'relation'
                                 // | 'html'
  configSchema: ZodType<Config>  // validates per-field options stored in fields_json
  valueSchema: (cfg: Config) => ZodType<Value>   // (2) one validator for ALL surfaces
  toIndex?: (v: Value) =>                        // (1) promoted to document_index for query/sort;
    string | number |                            //     an ARRAY return emits one row PER ELEMENT
    ReadonlyArray<string | number> | null        //     (multi-valued fields, e.g. multi-relation)
  toSearchText?: (v: Value) => string | null     // (1b) FULL plain text for the FTS5 search index
                                                 //     (D28); fallback: toIndex's string output
  multiValued?: (cfg: Config) => boolean         // declares the array-return case for this config
  beforeSave?: (v: Value, ctx: SaveCtx) => Value | Promise<Value>
  beforeRender?: (v: Value, ctx: RenderCtx) => unknown | Promise<unknown>
  EditComponent: FC<FieldEditProps<Config, Value>>   // (4) Datastar-wired form widget
  CellComponent?: FC<FieldCellProps<Value>>          // (3) list-view cell (fallback: text render)
  ViewComponent?: FC<FieldViewProps<Config, Value>>  // read-only detail/public render (C1, D23);
                                                     // fallback: SAFE ESCAPED TEXT
  jsonSchema: (cfg: Config) => JSONSchema            // (5) OpenAPI + (6) MCP input schemas
}
```

Rules:
- A field type **must** implement every non-optional member. No partial types.
- `valueSchema` is the single source of validation truth. Admin, REST, and MCP all run the same
  Zod validator. Never add surface-specific validation.
- `toIndex` returns a scalar, an array, or null. Omit it for types that can't be meaningfully
  sorted/filtered (e.g. `json`); such fields cannot set `"index": true`.
- `toSearchText` (D28) feeds the FTS5 search index with the field's FULL plain text — unlike
  `toIndex`, which may truncate (markdown/html store a 200-char lead-in). Implement it on any type
  whose `toIndex` truncates or that carries prose; types without it fall back to their `toIndex`
  string output. Search indexing ignores `index: true` — every field with text is searchable
  (`?q=`/`search_<slug>` — FTS is its own surface, DATABASE_STANDARDS.md).
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
- **The render seam (C1, D23):** `ViewComponent` drives the read-only detail and public surfaces,
  dispatched by `FieldView` (`src/components/field-view.tsx`). Unsafe-by-default is impossible:
  the fallback is escaped text, so only a type that explicitly opts in renders markup. `markdown`
  renders through the sanitizing renderer (`src/lib/markdown` — raw HTML escaped, dangerous
  protocols stripped; NEVER enable `allowDangerousHtml`); `relation` renders title links (public
  vs admin URLs by `surface`); `media` an `<img>`. Storage always keeps the raw source (D3).
- **`html`** (`src/fields/html.tsx`, D25) is the trusted-raw-HTML type: its `ViewComponent`
  renders the value VERBATIM (`dangerouslySetInnerHTML` into `div.rm-html`) — the second
  sanctioned markup exception after `markdown` (SECURITY_STANDARDS §7). Trust model:
  collection-level write permission ONLY (the reserved field-level `access` hook stays unused in
  v1); writable over REST/MCP by design — scope html-bearing collections to trusted roles. The
  value is length-bounded (SEC-4) and `toIndex` strips tags, so query/sort see text, not markup.
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
  "access": { "publicRead": true },         // publicRead XOR private (D46) — anon read vs hide-from-discovery
  "renderMode": "shell"                     // 'shell' (default) | 'raw' — see render mode (D27)
}
```

- Field `key`s must be unique per collection, `^[a-z][a-z0-9_]*$`, and must not collide with
  engine-reserved keys (`id`, `status`, `createdAt`, `updatedAt`, `publishedAt`, `createdBy`).
- A `slug` field is **indexed by default** (`index: true` unless explicitly set `false`): its value
  is the pretty public URL, which `getDocumentBySlug` and `publicUrlOf` (feeds/canonical/OG) resolve
  through `document_index` — an un-indexed slug silently 404s and drops out of RSS/sitemap. A
  `relation` you want **backlinks** or filtering on must still set `index: true` explicitly (the
  reverse-edge lookup reads the relation's index rows; indexing carries a per-edge write cost).
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
