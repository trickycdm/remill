# Database Standards

> **STATUS: TARGET — the fixed-table schema and query layer land in Phase 1; the `document_index`
> sync and revision append land with the schema engine (Phase 2); the access tables in Phase 3.** The
> authoritative column definitions live in `src/db/schema.ts` — this doc documents *which tables exist
> and why*, never the exact column lists (they belong in code).

Standards for all database-touching code. remill runs on **D1 (SQLite) with Drizzle for the fixed
tables only** — dynamic content is schema-as-data (SCHEMA_ENGINE.md), so Drizzle migrations stay rare.

## The layering invariant (see CODING_CONVENTIONS.md)

```
Routes / DOs  →  Services (src/services/)  →  Queries (src/db/queries/)  →  D1
```

- **`src/db/queries/` is the only Drizzle importer.** Services must not call `drizzle(db)`; routes and
  DOs never touch D1. A service needing a new access pattern adds a query function with proper
  row↔domain mapping — it does not reach past the query layer.
- The `DB` binding is server-only (`c.env.DB`). Services receive `db` as a parameter; they never
  import it.

## No RLS — authorization is in services

D1 is SQLite: **no row-level security, no `auth.uid()`, no service role.** Every ownership/role check
is TypeScript, at the service layer, through the single `authorize()` choke point (ACCESS_CONTROL.md).

- **Never post-filter lists in memory.** The access module compiles the principal's permissions into
  SQL predicates (`status='published' OR created_by=? OR id IN (grants…)`) applied **inside** the
  query. In-memory filtering leaks unreadable rows through pagination and miscounts totals.
- Document read/mutate query functions require a `Grant` witness parameter that only `src/access/` can
  construct — skipping `authorize()` is a compile error, not a convention.

## The fixed tables (the only Drizzle-migrated schema)

Content tables (Phase 1–2), from plan §3:

| Table | Purpose |
|---|---|
| `collections` | slug, name, shape (`collection`/`singleton`), `fields_json`, workflow/api flags, timestamps |
| `documents` | nanoid id, collection slug, `data_json`, status (`draft`/`published`), created/updated/published_at, created_by |
| `document_revisions` | document id, revision number, `data_json`, saved_by, saved_at — **append-only** |
| `document_index` | document id, field key, `value_text`, `value_num` — the query/sort/filter surface for JSON content; synced on save (see below) |
| `media` | nanoid id, r2_key, filename, mime, size, width/height/duration, alt, `variants_json` |
| `users` | human credentials: principal id, email, scrypt hash |
| `api_tokens` | principal id, name, **token hash** (never plaintext), narrowing scope mask, expires_at, last_used_at |

Access tables (Phase 3, from plan §4 / ACCESS_CONTROL.md): `principals`, `roles`, `role_permissions`,
`principal_roles`, `item_grants`, and append-only `audit_log`. **Dynamic content never alters this
schema — that is the entire point.** Adding a content type is a row in `collections`, not a migration.

## `document_index` — the EAV compromise (decision D4)

Dynamic fields can't use static columns — SQLite generated columns can't be per-collection-dynamic and
runtime DDL is migration hell. So indexable field values are promoted into a narrow **entity-attribute-
value** table, one row per (document, indexed field):

- Two typed value columns: **`value_text`** and **`value_num`**. A field type's `toIndex` returns a
  scalar (string → `value_text`, number → `value_num`) or `null`; types that can't be meaningfully
  sorted/filtered omit `toIndex` and cannot set `"index": true` (SCHEMA_ENGINE.md).
- Only fields marked `"index": true` in the collection definition get index rows. This is the surface
  REST/MCP filter, sort, and paginate against — never scan `data_json` with `LIKE`.
- **Index rows are synced on every document save**, inside the same atomic batch as the document write
  and revision append (below). The index is derived state; `data_json` is the source of truth.
- Accepted v1 trade: fine at lightweight scale, degrades with huge collections + heavy filtering. The
  escape hatch is SQLite FTS5, added later without changing the write path — do not optimise early.

## Atomic save: `db.batch()` (the core write)

D1 exposes no `BEGIN/COMMIT` via the Workers binding — **`db.batch()` is the atomicity primitive**
(multiple statements, one round-trip, all-or-nothing). Every document write is **one batch** carrying:

1. the document upsert (`data_json`),
2. the `document_index` sync — **delete all index rows for the document, then insert the new set**
   (never partially update child rows; delete-then-insert avoids orphans and races),
3. the `document_revisions` append.

If any statement fails, none apply — the document, its index, and its revision history never drift
apart. Put this batch in one query function; the documents service calls it after the whitelist
validation and `beforeSave` transforms (SCHEMA_ENGINE.md save pipeline).

## JSON-as-text columns

- D1/SQLite has no native array/JSONB type — arrays and objects are stored as **`TEXT`**. Columns
  holding serialised data use the `_json` suffix: `data_json`, `fields_json`, `variants_json`.
- **Parse and serialise only in `src/db/queries/`** — services and routes pass domain types (objects,
  arrays), never raw JSON strings. Always parse with a safe fallback:
  `JSON.parse(row.dataJson || '{}')`.

## Query performance

- **No N+1.** Batch-load related rows with `inArray()` (e.g. index rows for a page of documents) — one
  query, not one per document. Pre-fetch once and pass down.
- **Cursor pagination, not OFFSET** for list views — key on `created_at` + `id`. `LIMIT N OFFSET M`
  scans and discards M rows per page.
- **Index FK and filter columns.** SQLite doesn't auto-index FKs. Index `documents.collection`,
  `document_index.document_id`, `document_index(field_key, value_text)` and `(field_key, value_num)`
  for filtered lists, and the access-table FKs. Run `EXPLAIN QUERY PLAN` before adding an index and
  don't over-index (every index slows writes). Use `.get()` for 0/1-row lookups, `.all()` for many.

## Schema design

- **Timestamps are ISO-8601 TEXT** (`datetime('now')` default) — D1 has no `timestamptz`.
- **Booleans are INTEGER 0/1** — coerce to `boolean` at the query layer.
- **`NOT NULL` by default**; be explicit with `.notNull()`. **CHECK constraints** for fixed enums
  (`status IN ('draft','published')`) — Drizzle doesn't generate these; add them in the raw migration.
  **UNIQUE constraints** for business rules (unique slug per collection) — app-level checks race.
- **Cascades deliberately**: deleting a document cascades to its `document_revisions` and
  `document_index` rows; enable FK enforcement (`PRAGMA foreign_keys = ON` — Wrangler does this for D1).

## Schema edits vs existing documents (v1 policy — mirror SCHEMA_ENGINE.md)

When a field is removed or retyped after content exists: old values **persist** in `data_json`, are
**hidden** when undeclared (the whitelist strips them at render), and their `document_index` rows are
**dropped on the document's next save**. **Never destructively migrate content** — no bulk rewrite of
`data_json`, no `DROP COLUMN` on the fixed schema to reflect a content-type change (content types don't
have columns). State-changing content migrations are a post-v1 feature with their own design.

## Errors

Catch D1 constraint errors in **services** and re-throw as typed `AppError` — never leak a raw message:

| Condition | Message fragment | Throw |
|---|---|---|
| Unique violated | `UNIQUE constraint failed` | `BadRequestError` 400 |
| FK violated | `FOREIGN KEY constraint failed` | `BadRequestError` 400 |
| NOT NULL violated | `NOT NULL constraint failed` | `BadRequestError` 400 |
| CHECK violated | `CHECK constraint failed` | `BadRequestError` 400 |
| D1 unavailable / timeout | D1-level error | `InternalServerError` 500 |

Log with structured context first: `log.error({ collection, documentId, err }, 'failed to save')`. See
ERROR_HANDLING.md.

## Migrations

1. Edit `src/db/schema.ts`. 2. `bun run db:generate` (Drizzle Kit diffs, emits SQL in
`src/db/migrations/`). 3. **Review the SQL** — add indexes and CHECK constraints Drizzle Kit omits.
4. `bun run db:migrate` (local, `--local`). 5. `bun run db:migrate:remote` (production).

**Never edit an applied migration** — create a new one. For destructive changes to the *fixed* schema,
use expand-contract (add nullable → write both → backfill → switch reads → drop old in a later
migration). Add `NOT NULL` to a populated column only with a `DEFAULT` in the same `ALTER TABLE`.
