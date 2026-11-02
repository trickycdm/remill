# Agent schema management — let connected agents create collections (D64)

**Status:** shipped in v1.19.0 · 2026-11-02

## Problem

Agents connected by URL (OAuth — claude.ai, Claude Desktop, any MCP client) cannot create
collections. `create_collection` / `update_collection` / `install_pack` are listed only for a
principal holding `manage_schema` (`src/mcp/tools.ts`), and the OAuth consent screen offers every
role except `admin` (`CONSENT_EXCLUDED_ROLES`, `src/services/oauth/index.ts`). No other built-in
role carries `manage_schema`, so an OAuth agent never sees the tools. Two follow-on gaps make the
tool hard to use even when visible:

1. `create_collection`'s input schema is an opaque `{definition: object}` — the agent must guess
   the 12 field types and their per-type `config` shapes.
2. A new collection's `create_<slug>` etc. tools don't appear in the client's cached tool list
   until it reconnects; nothing tells the agent that.

## Approach

### 1. A `builder` system role (root cause)
- `builder` — "Builder": editor's actions (`read create update delete publish share_link comment`)
  **plus `manage_schema`**; no `manage_access`. Offered on the consent screen and in the connect
  wizard automatically (only `admin`/`anonymous` are excluded). Consent default stays `editor`.
- Mirrored in the three places the drift guard watches: `SYSTEM_ROLES` (`src/access/policy.ts`),
  `src/db/seed.sql`, and a migration `0022_builder_role.sql` for existing installs (prod never
  re-runs seed.sql). Migration inserts the role row + permission rows with `INSERT OR IGNORE`,
  guarded on the `roles` table already holding the system roles (fresh DB: seed.sql creates it),
  following the 0017 precedent. Migration test mirrors the 0017 one.
- Trade-off accepted: `manage_schema` includes flipping a collection public; a human consents to
  the role, and D57's explicit `onEnablePublic` still applies.

### 2. A real JSON Schema for the collection definition
- `collectionDefinitionJsonSchema()` in `src/services/collections/` — generated, never
  hand-written: per-field-type `oneOf` branches (`type: const`, `config` from each field type's
  `configSchema` via `z.toJSONSchema`), `workflow`/`access`/`bind` from the service's own Zod
  schemas, `template` from `TEMPLATE_KEYS`, `renderMode` enum, key/slug patterns.
- Used as the `definition` property schema on `create_collection` and `update_collection`.
  `validateDefinition` remains the authority (the schema is guidance; server still validates).
- Test: every registered field type appears; a pack definition validates against the schema
  shape (type/const coverage); description lists the field types.

### 3. Tell the agent where its new tools are
- `create_collection` and `install_pack` MCP results gain `tools` (the generated tool names for
  the new collection(s)) and a `note`: the client may need to reconnect / refresh its tool list
  before they appear. MCP-handler-only wrapping — service return types unchanged.
- Out of scope (backlog): pushing `notifications/tools/list_changed` via an SSE-framed POST
  response.

### 4. Docs
- `docs/TECH_DECISIONS.md` D64 row; `steering/ACCESS_CONTROL.md` system roles; 
  `steering/API_AND_MCP_STANDARDS.md` schema-management tools; `CLAUDE.md` status line;
  `plans/BACKLOG.md` (listChanged push).

### 5. Ship
- type-check, lint, unit tests; commit to `main`; push; tag the next minor (`v1.19.0`) to deploy
  via GitHub Actions; verify the live consent screen lists Builder and the migration applied.

## Revision Log
- 2026-11-02: migration 0022 rewritten from one UNION ALL insert to one guarded INSERT per row —
  D1 rejects the compound SELECT ("too many terms"); better-sqlite3 in unit tests did not. Added:
  `protected` accepted by the schema (round-trip of list_collections output) and forced `false`
  on create (an agent must not mint undeletable collections).
