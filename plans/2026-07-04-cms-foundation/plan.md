# Plan: A lightweight, agent-native CMS on Cloudflare

**Status:** Approved for build — start at Phase 0
**Date:** 2026-07-04
**Working name:** `remill` (placeholder — rename freely; it nods to its ancestor, Blogmill)
**Repo:** brand-new standalone repository (single package, not a monorepo)
**Reference repos (read-only, optional):** `~/repos/blogmill` (concept ancestor), `~/repos/dpt-platform` (stack template)

> **How to use this document.** This plan is standalone: everything needed to build the CMS is stated here — the what, the why, and the approach. The two reference repos add concrete examples but are not required. Place this file at `plans/2026-07-04-cms-foundation/plan.md` in the new repo, create `worklog.md` beside it, and keep both current as you build. When re-planning, edit this file in place (strikethrough abandoned approaches, add a Revision Log) — never fork a second plan file.

---

## 1. What we are building

A **single-tenant, lightweight, agent-native CMS** that runs on Cloudflare Workers. It manages any type of content — text, images, video, audio, and arbitrary structured records — and exposes that content three ways:

1. A **styled management interface** (server-rendered, Datastar-driven) — part of the core build, not an afterthought. It should feel like a designed product, not a generated admin.
2. A **JSON REST API** for programmatic and headless consumption.
3. An **MCP server**, so AI agents are first-class clients: they can read, write, publish, and even define new content types.

The public-facing website is **out of scope for v1**. The CMS is headless-first; a rendering/theme layer can be added later as just another API consumer.

### Why this exists

The author previously built Blogmill (~2018), a small Node/Express/MySQL CMS. Its implementation is dead — process-global state, jQuery/Grunt/TinyMCE, raw SQL string-building, and several real security holes (mass assignment of the whole request body, unescaped SQL identifiers, a shared weak signing secret). None of that code survives.

But its **central idea is excellent and predates the tools that later popularized it** (Payload, Directus): a declarative schema where **one field descriptor drives everything**. In Blogmill, a single JS object per content type generated the SQL DDL, the admin list view, the admin edit form, and the validation/save pipeline. The whole admin ran on two generic routes (`/cms/:page`, `/cms/:page/:id`); adding a content type meant adding one file. The engine was ~350 lines.

This project reimplements that idea on a modern substrate and **extends it from four generated surfaces to six**:

> **One collection definition generates: (1) storage, (2) validation, (3) the admin list view, (4) the admin edit form, (5) the REST API, (6) the MCP tools.**

That through-line is the product. Everything else is supporting infrastructure. It is also what makes the CMS *agent-native* rather than agent-bolted-on: because collections are data (not code — see §3), an MCP client can define a new content type and then populate it, entirely over the wire.

### Design goals

- **Lightweight**: one Worker, one D1 database, one R2 bucket. Deployable with `wrangler deploy`. No build farm, no separate admin SPA, no external services required to run.
- **Agent-native**: MCP is a core surface with parity to the admin UI. Content is stored agent-friendly (Markdown, structured JSON) rather than as opaque HTML blobs. Autonomous agents are first-class principals with their own identities, least-privilege roles, and audit trails (§4) — not users of a shared API key.
- **Schema-driven everywhere**: if a feature can't be generated from the collection definition, question whether it belongs.
- **Designed, not generated-looking**: the admin has a real visual identity, design tokens, and a component library.

### Non-goals (v1)

- Multi-tenancy or multi-site (single tenant is a hard decision — multi-tenancy is where lightweight goes to die).
- Public site rendering / themes (headless-first; revisit post-v1).
- Plugin system (extensibility comes from the field-type registry, which is code).
- Field-level access control (per-field read/write visibility) — deferred; the descriptor reserves the hook point (§4). Collection- and item-level access control **is** core scope: see §4.
- Localization/i18n, webhooks, realtime collaboration, video transcoding (Cloudflare Stream can be added later if needed).

---

## 2. Architecture overview

```
                        ┌──────────────────────────────────────────────┐
                        │  One Cloudflare Worker (Hono, file routing)  │
                        │                                              │
  Browser (admin) ────▶ │  /admin/**   Datastar SSR management UI      │
  Any HTTP client ────▶ │  /api/**     JSON REST (bearer tokens)       │
  AI agents ──────────▶ │  /mcp        MCP server (McpAgent on a DO)   │
  Media consumers ────▶ │  /media/:id  R2 streaming (range requests)   │
                        │                                              │
                        │  Routes → Services → Queries → D1            │
                        └───────┬──────────────────────┬───────────────┘
                                │                      │
                          D1 (SQLite)             R2 (objects)
                     collections, documents,     media originals
                     revisions, index, media     (+ variants later)
                     meta, users, api_tokens
```

### Tech stack (pinned decisions)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers, Wrangler 4 | Deploy target; proven by dpt-platform |
| Language | TypeScript strict, Bun as package manager/runner | dpt-platform convention; fast, simple |
| HTTP framework | Hono 4 | Workers-native, tiny, first-class JSX |
| Routing | `hono-router` file-based codegen (`src/routes/**` → generated `src/router.ts`) | Convention-over-configuration; Blogmill's filesystem routing, modernized |
| Templating | Hono JSX server-rendered — **no React** | SSR-first; islands only where unavoidable |
| Hypermedia | **Datastar v1** (signals, SSE element/signal patches) | Reactive admin without a client framework; dpt-platform has battle-tested patterns |
| Styling | Tailwind v4, CSS-first `@theme` tokens | Design tokens as the single styling source of truth |
| Build | Vite 7 + `@cloudflare/vite-plugin` + `vite-ssr-components` | Workers emulation in dev; proven combination |
| Database | D1 (SQLite) + Drizzle ORM for the **fixed** tables only | Content is schema-as-data (§3), so Drizzle migrations stay rare |
| Object storage | R2 | Media originals; streamed with range support |
| Validation | Zod 4 — generated at runtime from field descriptors | One validator serves admin, REST, and MCP |
| Auth (admin) | `hono-sessions` encrypted cookie + scrypt (`@noble/hashes`) | External-store-free; port from dpt-platform |
| Auth (API/MCP) | Bearer tokens **bound to agent principals**, hashed at rest, permission-narrowing scope masks | Agents are identities, not shared keys; revocable per agent |
| Authorization | Central default-deny decision module — RBAC + per-item grants (§4) | One choke point serving admin, REST, and MCP |
| MCP | Cloudflare `agents` SDK — `McpAgent` on a Durable Object, streamable HTTP at `/mcp` | The supported way to run MCP on Workers |
| Uploads | Uppy (client) → Worker → R2 (multipart for large files) | Uppy survives from Blogmill — still the best upload UI |
| Rich text | CodeMirror 6 Markdown island + live preview | Markdown-first content (§5 D3); avoids contenteditable pain; WYSIWYG can come later |
| IDs | nanoid | dpt-platform convention |
| Testing | Vitest 3 (unit) + Playwright (e2e, axe a11y sweeps) | dpt-platform convention |

### Layering invariant (adopted from dpt-platform, non-negotiable)

**Routes and Durable Objects never touch D1 directly.** The layering is:

```
Routes / DOs → Services (src/services/) → Queries (src/db/queries/) → D1
```

Queries are the only layer importing Drizzle; row↔domain mapping is private there. Services hold all business logic and all authorization checks (D1 has no RLS — ownership/role checks live in code, always). Routes stay thin: parse, call service, render.

### What we take from dpt-platform (lift from `surfaces/skill-scan/`)

The dpt-platform monorepo's "platform" layer (auth-do, data-do, domain-contract) is acknowledged stubs — ignore it entirely. The single `surfaces/skill-scan` Worker, however, is mature, and these parts port nearly verbatim:

- **Build skeleton**: `vite.config.ts`, `src/layouts.tsx`, `src/main.tsx` wiring (middleware → jsxRenderer → loadRoutes → onError → notFound).
- **Datastar mechanism library**: `src/lib/datastar-response.ts` (dsRedirect / inline-fragment / dsError idioms — all responses 200 because Datastar only applies 2xx patches), `src/lib/json-for-script.ts` (the only sanctioned `dangerouslySetInnerHTML`), `src/lib/datastar-chat-stream.ts` (SSE patch streaming, useful later for AI-assisted authoring).
- **Datastar hard-won gotchas** (from `steering/DATASTAR_PATTERNS.md` — port this doc): kebab-case signal keys (HTML lowercases colon-keys); `data-computed` reading another `data-computed` silently freezes; reactive expressions are opaque strings that type-checks can't verify (Playwright is the safety net); `@get` on load-fragments full-page-reloads (use a lazy-fetch island).
- **Sessions/auth**: `hono-sessions` encrypted cookie, scrypt hashing, `requireAuth()` guard middleware, role-in-session-never-from-client.
- **Error handling**: `AppError` hierarchy with machine-readable codes + global `onError` (401 → login redirect; Datastar requests → dsError; else JSON `{error, code}`).
- **CI**: type-check → lint → test → build, plus per-PR ephemeral Worker + preview D1 deploys with teardown (`.github/workflows/ci.yml`, `preview-cleanup.yml`).
- **The documentation system** — see Phase 0, which exists because of how well this works in dpt-platform.

### What dpt-platform does NOT provide (net-new builds)

- **Media/upload/R2 infrastructure — none exists there.** Its "video/audio" is live AI avatar conversation, not stored assets. Our media pipeline is built from scratch (Phase 4), which is why it gets its own steering doc.
- **MCP server — none exists.** Notably, dpt-platform built a premature SDK-agnostic tool layer and *deleted it* (`steering/TOOL_STANDARDS.md` is marked NOT IMPLEMENTED). Lesson: don't over-abstract; our MCP tools are generated directly from collection definitions, not routed through a tool-framework indirection.
- **Clean JSON REST API** — its API routes return Datastar HTML patches. Ours are separate, content-negotiated surfaces.

### What we take from Blogmill (concepts only — zero code)

| Concept | Blogmill original | Modern form |
|---|---|---|
| Unified field descriptor | `fields[]` in `cms/schemas/*.js` drives DDL + form + list + validation | §3 — drives six surfaces, stored as data |
| Hook pipeline | per-type `preSave`/`validate`, per-field-type `fieldPreSave`/`preFieldRender` as Express middleware | Field-type registry contract (code) + declarative collection behaviors (data) — §3 |
| Dynamic component dispatch | Handlebars dynamic partials keyed by field type | Admin component registry keyed by field type (Hono JSX) |
| Two content shapes | `single: true` singletons vs collections | `shape: 'collection' \| 'singleton'` — site settings become a built-in singleton collection (dogfooding) |
| Generic admin routes | `/cms/:page`, `/cms/:page/:id` served every type | `/admin/c/:collection`, `/admin/c/:collection/:id` serve every type |
| Draft/publish + slugs | `status` field, slugify-on-save, uniqueness guard | Same, plus revisions (Blogmill never had version history) |
| Media as a content type | `media` schema with a UI-only upload field | Same trick: media metadata rides the schema engine; upload is a special field type |

What we explicitly do **not** carry: TinyMCE HTML-blob content, per-collection arbitrary-code hooks defined in the database, process globals, theme system (deferred).

---

## 3. The schema engine (the heart — get this right)

### Collections are data; field types are code

Blogmill's schemas were JS files — changing a content type meant a deploy. We invert that:

- **Field types** live in code: a registry in `src/fields/`, one module per type. Each field-type module implements a single contract (below). Adding a *field type* is a code change — appropriate, because it ships validation logic and UI components.
- **Collections** live in the database: rows in a `collections` table whose `fields_json` composes field types declaratively. Adding or changing a *content type* is a runtime operation — doable from the admin UI or over MCP, no deploy.

This split preserves Blogmill's hook symmetry (field types still own transform/validate/render logic — that's the code side) while making content modeling itself dynamic (the data side). Per-collection *arbitrary-code* hooks are deliberately excluded from v1; common behaviors are declarative flags instead (slug source, timestamps, publish workflow).

### The field-type contract

Every field type module exports one object satisfying:

```ts
interface FieldType<Config, Value> {
  key: string                    // 'text' | 'markdown' | 'number' | 'boolean' | 'datetime'
                                 // | 'select' | 'media' | 'reference' | 'tags' | 'slug' | 'json'
  configSchema: ZodType<Config>  // validates the per-field options stored in fields_json
  valueSchema: (cfg: Config) => ZodType<Value>   // (2) validation — one validator for all surfaces
  // storage & indexing
  toIndex?: (v: Value) => string | number | null // (1) value promoted to document_index for query/sort
  // transforms (Blogmill's fieldPreSave / preFieldRender, reborn)
  beforeSave?: (v: Value, ctx: SaveCtx) => Value | Promise<Value>
  beforeRender?: (v: Value, ctx: RenderCtx) => unknown | Promise<unknown>
  // admin surfaces
  EditComponent: FC<FieldEditProps<Config, Value>>   // (4) edit form widget (Datastar-wired)
  CellComponent?: FC<FieldCellProps<Value>>          // (3) list-view cell renderer
  // machine surfaces
  jsonSchema: (cfg: Config) => JSONSchema            // (5) REST OpenAPI + (6) MCP tool input schemas
}
```

The numbered comments are the six generated surfaces. **This contract is the most important interface in the codebase** — it gets its own steering doc (`SCHEMA_ENGINE.md`) and everything else is downstream of it.

### The collection definition (stored in D1 as data)

```jsonc
{
  "slug": "posts",
  "name": "Posts",
  "shape": "collection",            // or "singleton"
  "fields": [
    { "key": "title",   "type": "text",     "required": true, "index": true,
      "admin": { "showInList": true } },
    { "key": "slug",    "type": "slug",     "config": { "from": "title" }, "unique": true },
    { "key": "body",    "type": "markdown" },
    { "key": "hero",    "type": "media",    "config": { "kinds": ["image"] } },
    { "key": "tags",    "type": "tags",     "index": true },
    { "key": "author",  "type": "reference","config": { "collection": "users" } }
  ],
  "workflow": { "draftPublish": true },     // declarative behaviors, not code hooks
  "access": { "publicRead": true }          // sugar: anonymous role may read published docs;
                                            // a full role→action map is also allowed (§4)
}
```

On every save through any surface, the engine: loads the collection → builds the Zod validator from field types → validates **only declared fields** (whitelist — the direct fix for Blogmill's mass-assignment hole) → runs `beforeSave` transforms → writes the document → syncs `document_index` rows → appends a revision.

### Storage model (fixed D1 tables — the only Drizzle-migrated schema)

| Table | Purpose |
|---|---|
| `collections` | slug, name, shape, `fields_json`, workflow/api flags, timestamps |
| `documents` | nanoid id, collection slug, `data_json`, status (`draft`/`published`), created/updated/published_at, created_by |
| `document_revisions` | document id, revision number, `data_json`, saved_by, saved_at — append-only |
| `document_index` | document id, field key, `value_text`, `value_num` — the query/sort/filter surface for JSON content; synced on save |
| `media` | nanoid id, r2_key, filename, mime, size, width/height/duration, alt, `variants_json` |
| `users` | human credentials: principal id, email, scrypt hash |
| `api_tokens` | principal id, name, token hash (never plaintext), narrowing scope mask, expires_at, last_used_at |

Access control adds six more fixed tables — `principals`, `roles`, `role_permissions`, `principal_roles`, `item_grants`, `audit_log` — defined in §4.

Dynamic content never alters this schema — that's the point. `document_index` is a deliberate EAV-style compromise: SQLite generated columns can't be per-collection-dynamic, and v1 query needs (filter by indexed field, sort, paginate) fit it fine. If it becomes hot, D1's SQLite supports FTS5 for search later.

### Built-in collections (dogfooding)

`settings` (singleton — site name, description, defaults) and `media` metadata ride the schema engine as seeded, protected collections. If the engine can't express its own system needs, it isn't good enough — this was Blogmill's trick and it kept the engine honest.

---

## 4. Access control — agents as first-class principals (core, not bolt-on)

The CMS is agentic-first: autonomous agents read and write alongside humans, so per-item access control is core scope and must be designed in from the first service call — retrofitting authorization is how CMSes end up with the holes Blogmill had. The model is deliberately small: **default-deny, additive-only, one decision point, everything audited**. Expressiveness is traded for auditability on purpose.

### Principals: humans and agents are the same kind of actor

Every actor is a **principal** (`kind: 'user' | 'agent'`). Humans authenticate with sessions, agents with bearer tokens; both resolve to a principal before any decision is made, and every write, read decision, and audit row is attributed to one. Agents are **identities, not shared keys**: each autonomous agent gets its own principal, its own tokens, its own role assignments, its own audit trail. A built-in `anonymous` principal represents unauthenticated requests.

Tokens carry an optional **narrowing scope mask**: effective permission = principal's permissions ∩ token mask. A token can shrink an agent's blast radius but never widen it, so one agent can hold a broad token for trusted contexts and a read-only token for risky ones.

### The model: RBAC for broad strokes, item grants for precision

Two additive layers, default deny, no negative rules:

1. **Roles** — data-defined, like collections (so least-privilege custom roles can be created for specific agents at runtime, from the admin UI or MCP). Seeded: `admin`, `editor`, `author`, `reader`, `anonymous`. A role holds permission rows of shape `(collection | *, action, condition?)`. The action vocabulary is closed: `read, create, update, delete, publish, manage_schema, manage_access`. Conditions are a tiny declarative enum — `own` (created_by = this principal), `published` (status = published) — not arbitrary code, consistent with the schema engine's declarative-flags philosophy. Role *assignments* are collection-scopable: `(principal, role, collection | *)` — "editor, but only of posts."
2. **Item grants** — per-document tuples: `(principal | role, document_id, actions, granted_by, expires_at?)`. The per-item layer: "agent `researcher` may `update` document X until Friday."

Media rides collection permissions (upload = `create` on the `media` collection) — no parallel permission system. A collection's `access.publicRead` flag is sugar for granting `anonymous` `read` with condition `published`.

New fixed tables: `principals`, `roles`, `role_permissions`, `principal_roles`, `item_grants`, and an append-only `audit_log` (principal, token, surface `admin|rest|mcp`, action, resource, allow/deny, timestamp).

### One decision point, structurally unbypassable

`authorize(principal, action, resource)` in `src/access/` is the only place an allow/deny is computed. Admin, REST, and MCP all pass through it — one validation *and authorization* pipeline, three doors. Two mechanisms make bypass structurally hard rather than conventional (Rule 12 of the repo standards — types/CI over convention):

- **The witness type.** Query functions that read or mutate documents require a `Grant` value as a parameter, and only the access module can construct one. A service that skips `authorize()` doesn't compile.
- **Compiled list filters.** For list/search endpoints, the access module compiles the principal's permissions into SQL predicates (`status='published' OR created_by=? OR id IN (grants…)`) applied inside the query. Never post-filter in memory — that's how paginated lists leak unreadable items and miscount pages.

Denials return structured errors — `403 { code, missing: { action, collection } }` — so an agent can reason about what it lacks instead of flailing or retrying blindly.

### What this buys an agentic-first CMS

- **Least privilege by default**: a new agent principal can do nothing until granted a role.
- **"Agent proposes, human approves" falls out for free**: grant an agent `create` + `update` with condition `own` and no `publish` — it can draft and revise its own documents indefinitely, while `publish` stays with a human (or a separately-trusted reviewing agent). No workflow engine required; it's just the permission model.
- **Permission-aware MCP**: the generated tool list is intersected with the connecting principal's effective permissions — an agent without publish rights never sees `publish_posts`. Capability discovery *is* permission discovery, which keeps agents from planning actions they can't take.
- **Accountable autonomy**: the audit log records which agent, via which token, on which surface, did — or was denied — what. And `manage_access` is itself a permission held by humans by default, so agents cannot escalate themselves or each other.

### Deferred: field-level access

Per-field visibility (`access: { read: [roles], write: [roles] }` on a field descriptor) composes naturally with the whitelist pipeline — writable fields become whitelist ∩ permitted, unreadable fields are stripped at render. It is deferred to post-v1 because the admin UX cost is real, but the hook point is reserved in the FieldType and collection-definition contracts.

---

## 5. The three product surfaces

### 5a. Management interface (styled — core build, not scaffolding)

Server-rendered Hono JSX + Datastar. No client framework. Generic routes serve every collection:

```
/admin                      dashboard (recent activity, quick stats)
/admin/c/:collection        list view — generated columns, sort/filter/paginate, bulk actions
/admin/c/:collection/:id    edit view — generated form, draft/publish, revision history
/admin/media                media library — grid browse, upload (Uppy), detail/alt editing
/admin/collections          schema builder — create/edit collections & fields from the UI
/admin/access               principals (humans & agent identities), roles, item grants, tokens, audit log
/admin/settings             singleton editor
/admin/login                session auth
```

**Design mandate.** The admin must have a deliberate visual identity: design tokens defined once in Tailwind v4 `@theme` (color scale, type scale, spacing, radii — light and dark from day one), a small owned component library (`Button`, `Input`, `Select`, `Table`, `Drawer`, `Dialog`, `Toast`, `EmptyState`, `Badge`, `Nav`), and a distinctive direction — content-first and editorial, generous whitespace, confident typography; the personality memorable without getting in the way of daily use. Direction is locked in Phase 1 as `steering/DESIGN_SYSTEM.md` **before** feature UI is built, because every generated surface (field editors, cells, tables) composes these primitives — retrofitting design onto a generated admin never works.

Interaction model: full server renders per page; Datastar signals for form state, dirty tracking, inline validation errors, optimistic busy states; SSE patches for save feedback and upload progress. JS islands only where Datastar can't reach: CodeMirror markdown editor, Uppy uploader.

### 5b. REST API

```
GET    /api/collections                    list collection definitions
POST   /api/collections                    create a collection        (scope: schema)
PATCH  /api/collections/:slug              modify a collection        (scope: schema)
GET    /api/c/:collection                  list documents — ?filter[field]=, ?sort=, ?page=, ?status=
POST   /api/c/:collection                  create document            (scope: write)
GET    /api/c/:collection/:id              read document
PATCH  /api/c/:collection/:id              update document            (scope: write)
DELETE /api/c/:collection/:id              delete document            (scope: write)
POST   /api/c/:collection/:id/publish      publish / unpublish        (scope: publish)
GET    /api/c/:collection/:id/revisions    revision history
POST   /api/media                          upload (multipart)         (scope: write)
GET    /media/:id[/:variant]               serve file from R2 — range requests, immutable cache headers
```

Every request resolves to a principal and passes through `authorize()` (§4); token scope masks can further narrow a principal's permissions per token. Collections with `access.publicRead` allow unauthenticated (anonymous-principal) GETs of **published** documents only. Validation errors return the same Zod issue shape the admin uses; denials return the structured 403 from §4. An OpenAPI document is generated from the live collection definitions at `/api/openapi.json` — surface (5) of the engine.

### 5c. MCP server

`McpAgent` (Cloudflare `agents` SDK) on a Durable Object, streamable HTTP at `/mcp`, authenticated with the same API tokens. Tools are **generated per collection from the same field descriptors** (surface 6) — no hand-maintained tool list — and the registered set is **intersected with the connecting principal's effective permissions** (§4), so an agent only ever sees tools it may call:

- Per collection: `list_<slug>`, `get_<slug>`, `create_<slug>`, `update_<slug>`, `publish_<slug>` — input schemas from the field types' `jsonSchema`, honest descriptions from collection/field labels.
- Schema management: `list_collections`, `create_collection`, `update_collection` (requires `manage_schema`) — an agent can model content, then fill it.
- Media: `list_media`, `get_media_url`.
- Resources: expose published documents as MCP resources for read-heavy clients.

Tool registration re-derives from the `collections` table and the principal's permissions per session, so schema and access changes are visible to agents without redeploys. MCP write paths run through the exact same service layer as admin and REST — one validation and authorization pipeline, three doors.

---

## 6. Decision log (seeded — becomes `docs/TECH_DECISIONS.md`)

| # | Decision | Rationale | Alternatives rejected |
|---|---|---|---|
| D1 | New repo, new code; port Blogmill concepts only | Blogmill's substrate (globals, Express, MySQL, jQuery) is incompatible with Workers; its security posture is disqualifying | Incremental port (no viable path) |
| D2 | Collections as data, field types as code | Runtime content modeling is what makes MCP schema tools possible; field types need real code (validators, UI) | All-code schemas (Blogmill/Payload style — redeploy per change); all-data (nowhere for validation/UI logic to live) |
| D3 | Markdown-first rich text | Agent-legible, diff-able, portable; TinyMCE HTML blobs are the single most dated thing in Blogmill | HTML WYSIWYG (opaque to agents); Portable-Text-style JSON AST (heavier than v1 needs; revisit if block editing is wanted) |
| D4 | D1 + EAV index table for querying JSON content | Fixed schema stays tiny; dynamic fields can't use static columns; v1 query needs are modest | Per-collection tables w/ runtime DDL (migration hell); DO-SQLite-per-collection (complexity without a v1 payoff) |
| D5 | Single tenant, single site | Lightweight is the product; multi-tenancy multiplies auth, storage, and billing complexity everywhere | Multi-site (revisit only with a concrete need) |
| D6 | Headless-first; admin included, public rendering deferred | Admin is the product surface users touch daily; public rendering is cleanly separable as an API consumer | Bundled theme system v1 (Blogmill's scope trap) |
| D7 | Standalone single-package repo | dpt-platform's own monorepo platform layer is unwired stubs by its own admission | Adopting the dpt monorepo/turbo layout |
| D8 | Datastar SSR admin, no React | Proven in dpt-platform; tiny payload; islands cover the gaps (editor, uploads) | React/Next admin SPA (contradicts lightweight); HTMX (dpt already migrated off it) |
| D9 | Sessions for humans, bearer tokens for machines | Encrypted cookie needs no external store; tokens are revocable/scoped and MCP-friendly | JWT-everywhere (Blogmill's weak spot); OAuth provider (overkill single-tenant) |
| D10 | MCP via Cloudflare `agents` SDK on a DO | The supported Workers MCP path; DO gives session state | Hand-rolled MCP transport; premature tool-abstraction layer (dpt built one and deleted it) |
| D11 | R2 originals + variant-ready URL scheme; transforms deferred | `/media/:id/:variant` route shields consumers; Cloudflare Image Transformations can slot in without URL changes | Cloudflare Images/Stream from day one (cost/complexity before need) |
| D12 | Uppy for uploads | Maintained, excellent UX, direct-to-Worker multipart; the one Blogmill dependency worth keeping | Hand-rolled `<input type=file>` (poor resumability/progress) |
| D13 | CodeMirror 6 markdown island | Lightweight, no contenteditable fights, agents and humans see identical content | TinyMCE/Tiptap WYSIWYG v1 (heavy; revisit as an *additional* editor later) |
| D14 | Validation whitelist from field descriptors on every write path | Direct fix for Blogmill's mass-assignment vulnerability; one pipeline, three doors | Per-surface validation (drift guarantees a hole) |
| D15 | Humans and agents unified as principals; tokens belong to principals | One authorization pipeline; per-agent identity, revocation, and audit attribution; no shared keys | Separate "API key" model (unattributable writes); OAuth per agent (overkill single-tenant) |
| D16 | Default-deny, additive-only: RBAC (roles-as-data, scoped assignments, tiny condition enum) + per-item grants; no negative rules | Comprehensible and auditable; per-item precision without a policy language; "agent drafts, human publishes" falls out naturally | Full ABAC/policy DSL (complexity kills auditability); pure RBAC (no per-item control); external Zanzibar-style service (not lightweight) |
| D17 | Authorization enforced by witness types + SQL-compiled list filters | Bypassing `authorize()` is a compile error; paginated lists structurally can't leak (types/CI over convention) | Convention-only "services should check" (guarantees drift); in-memory post-filtering (leaks under pagination) |

---

## 7. Build phases

Each phase ends with: runnable verification (stated per phase), steering docs updated to describe what now exists, worklog entry, deployed preview.

### Phase 0 — Repo standards & steering (FIRST, before any feature code)

The dpt-platform documentation system is the most transferable thing it owns. We adopt it wholesale on day one, because steering docs shape every agent session that builds the rest. **Deliverables:**

1. **`AI_NATIVE_REPO_STANDARDS.md`** — copy the portable canon from dpt-platform root (it's written to be copied). It defines the rules the rest of this phase implements: CLAUDE.md is canonical at every altitude; AGENTS.md is a one-line pointer; steering is hierarchical, composed with `@`-imports, capped ~200 lines per file; `steering/` holds prescriptive standards, `docs/` holds descriptive reference; never state aspirational architecture as current fact (mark targets with adoption status); plans + worklogs live in `plans/`; every task carries a runnable verification.
2. **Root `CLAUDE.md`** — thin architectural map (<200 lines): stack, the layering invariant, the six-surfaces concept in three sentences, commands, and a Required Reading table mapping area → steering doc (mirror the skill-scan pattern). **`AGENTS.md`** — pointer.
3. **`steering/` — ported & adapted from dpt-platform** (mark any not-yet-wired claim as target):
   - `CODING_CONVENTIONS.md`, `ERROR_HANDLING.md`, `SECURITY_STANDARDS.md`, `A11Y_STANDARDS.md` (WCAG 2.1 AA), `TESTING_AND_VERIFICATION.md`, `E2E_TESTING.md` — adapt from dpt root + skill-scan steering.
   - `DATASTAR_PATTERNS.md` — port near-verbatim; it encodes hard-won v1 gotchas we must not relearn.
   - `DATABASE_STANDARDS.md` — adapt: layering invariant, JSON-as-text conventions, `db.batch()` atomic child sync, no-RLS-so-authorize-in-services, plus our documents/index/revisions model.
4. **`steering/` — new-concept docs, created as design contracts** with an explicit `STATUS: DESIGN — implemented in Phase N` header (honest-status rule), finalized when their phase lands:
   - `SCHEMA_ENGINE.md` — the FieldType contract, collection definition shape, the six-surfaces invariant, whitelist-validation rule, how to add a field type. *The constitution of the codebase.*
   - `ACCESS_CONTROL.md` — the principal model, role/permission/grant tables, the `authorize()` contract, the witness-type and compiled-list-filter rules, audit requirements, structured deny-error shape, and the additive-only/no-negative-rules invariant (§4).
   - `MEDIA_STANDARDS.md` — see Phase 5 for required content.
   - `API_AND_MCP_STANDARDS.md` — auth/principal resolution, token scope masks, error shape, pagination, tool naming/generation rules, permission-filtered tool listing, publicRead semantics.
   - `DESIGN_SYSTEM.md` — skeleton now; filled by Phase 1's design work.
5. **Harness**: `.claude/settings.json` committed allowlist (build/lint/test/type-check/read-only git); pre-commit hook running type-check + lint (repo root, real package manager); `plans/` directory with this document as `plans/2026-07-04-cms-foundation/plan.md` + `worklog.md`; `docs/PROJECT_BRIEF.md` (distilled §1) and `docs/TECH_DECISIONS.md` (seeded from §6).
6. **CI skeleton**: GitHub Actions — type-check → lint → test → build; per-PR preview deploys + teardown (port from dpt-platform).

*Verification: a fresh Claude session in the repo, asked "how do I add a field type?", answers correctly from steering alone — before the code exists (the docs say DESIGN status). CI green on the empty skeleton.*

### Phase 1 — Application skeleton + design system

Lift the skill-scan bones: Vite/Wrangler/Hono/Datastar wiring, layouts, sessions + login, error hierarchy + onError, structured logging, D1 + Drizzle with the fixed tables, seed script (first user, `settings` + `media` collections). **Design system**: lock the visual direction; implement tokens in `@theme` (light + dark); build the component library; render a styled `/admin` shell (nav, dashboard, login) with empty states. Finalize `DESIGN_SYSTEM.md` (tokens canonical in `tailwind.css` — the doc explains usage, never duplicates hex values).

*Verification: deployed preview — login, styled shell, dark/light toggle; Playwright smoke + axe sweep passes; type-check/lint/test green in CI.*

### Phase 2 — Schema engine core

The FieldType registry with the first types (`text`, `markdown` [storage/validation], `number`, `boolean`, `datetime`, `select`, `slug`, `tags`, `json`); collections service (CRUD on definitions, config validation); documents service (whitelist validation → transforms → save → index sync → revision append); draft/publish workflow; slug generation with uniqueness. Flip `SCHEMA_ENGINE.md` to IMPLEMENTED.

**Born authorized:** every collection/document service operation passes through `authorize()` from its first commit — in this phase only the seeded `admin` role policy is active, but the choke point, the `Grant` witness types, and audit writes exist from day one. The richer policy model arrives in Phase 3; the enforcement architecture is never retrofitted.

*Verification: unit suite round-trips every field type (config → validator → save → index → render); property tests for the whitelist (undeclared fields always rejected — the anti-mass-assignment guarantee); revision append on every save; a compile-fails test proving document queries reject un-witnessed calls.*

### Phase 3 — Access control core

The full §4 model behind the already-existing choke point: roles-as-data (CRUD + config validation, seeded system roles), collection-scoped role assignment, item grants with expiry, token scope masks, the complete decision function (role permissions ∪ item grants, conditions `own`/`published`, default deny), SQL filter compilation for permission-aware lists, structured deny errors, append-only audit log with surface/token attribution. Flip `ACCESS_CONTROL.md` to IMPLEMENTED.

*Verification: a permission-matrix unit suite (every action × role × condition, default-deny asserted for every uncovered cell); list-leak property tests (paginated results never contain an unreadable document and counts match the filtered set); grant-expiry tests; audit-row assertions on every allow and deny path.*

### Phase 4 — Generated admin

The generic routes (`/admin/c/:collection`, `/admin/c/:collection/:id`): generated list view (columns from `showInList`, cell renderers, sort/filter on indexed fields, pagination, bulk delete) and edit view (EditComponents composed per definition, Datastar dirty/busy/inline-error signals, draft-vs-publish actions, revision history with restore). CodeMirror markdown island. Schema builder UI (`/admin/collections`) — create/edit collections from the browser. Access management UI (`/admin/access`): create agent principals, assign roles, issue tokens with scope masks, manage item grants, browse the audit log. Settings editor. Admin navigation and actions render permission-aware (a principal never sees a button it can't use).

*Verification: Playwright e2e — create a collection in the UI, add fields of every type, create/edit/publish a document, restore a revision, all through the browser; an `author`-role session proving the UI hides and the server denies out-of-role actions; axe sweep on every admin page.*

### Phase 5 — Media pipeline

`media` field type; Uppy island → multipart upload route → R2 (streaming, no full buffering; R2 multipart for large video/audio); metadata extraction (dimensions, duration where cheap); `/media/:id[/:variant]` serving route with range-request support (video/audio seeking) and immutable cache headers; media library UI (grid, upload, alt/focal editing, usage lookup); variant URL scheme reserved, transforms stubbed to originals (D11). Finalize `MEDIA_STANDARDS.md`: upload size limits and the multipart threshold, allowed MIME allowlist + sniffing rules (never trust extension), R2 key scheme, serving/caching/range contract, alt-text-required-for-images (a11y), deletion semantics (block or orphan-check when referenced by documents).

*Verification: e2e upload image/audio/video via UI; range-request replay test (seek in a video); MIME-spoof rejection test; alt-required enforcement.*

### Phase 6 — REST API

The routes in §5b, token issuance/hashing/scope masks, publicRead semantics (anonymous principal, published-only), filter/sort/paginate over `document_index` through the compiled permission filters, OpenAPI generation from live definitions, rate-limit headers stubbed. Finalize the REST half of `API_AND_MCP_STANDARDS.md`.

*Verification: integration suite against a preview deploy exercising every endpoint plus a role × scope-mask denial matrix; OpenAPI validates; a scripted "headless blog" consumer renders published posts using only the public API.*

### Phase 7 — MCP server

`McpAgent` on a DO at `/mcp`; per-collection tool generation from field descriptors, filtered to the connecting principal's permissions; schema-management and media tools; resources for published content; token auth shared with REST. Finalize the MCP half of the steering doc.

*Verification: scripted MCP client (and Claude Code as a live client) — connect, `create_collection`, create/publish documents through generated tools, read back over REST. Then the agentic-governance demo: a least-privilege agent (`author` role, condition `own`, no publish) sees no publish tool, drafts content, is denied publish over the raw API, and a human publishes it from the admin — with every step attributed in the audit log.*

### Post-v1 backlog (explicitly deferred)

Image transforms (slot into `/media/:id/:variant`), FTS5 search, field-level access control (§4), webhooks, public rendering/theme layer, AI-assisted authoring (dpt's chat-stream patterns make this cheap later), Cloudflare Stream for transcoding, import tool for legacy Blogmill MySQL content.

---

## 8. Risks & watch-items

- **The FieldType contract is load-bearing.** Every surface hangs off it; changing it after Phase 4 is expensive. Spend real design time in Phase 2; review it against each of the six surfaces before building any.
- **Policy-model creep.** The action vocabulary and condition enum will attract feature requests (negative grants, hierarchical collections, time-boxed roles beyond grant expiry). Hold the line: additive-only, tiny closed enums — expressiveness was traded for auditability deliberately (D16). Extend only with a decision-log entry.
- **Authorization overhead per request.** Permission resolution is a few indexed SQLite reads (roles + grants), resolved once per request and carried on the context; list filtering rides the main query. Fine at lightweight scale — don't add caching layers until measured.
- **EAV index performance** is fine at lightweight scale but degrades with huge collections + heavy filtering. Acceptable v1 trade (D4); FTS5/materialization is the escape hatch. Don't optimize early.
- **Datastar expressions are invisible to the type-checker.** dpt-platform's mitigation is non-negotiable here too: Playwright e2e is the safety net for every interactive admin flow, not an afterthought.
- **Workers body-size limits** (plan-dependent, ~100–500 MB) bound uploads. Document the real limit for the account tier in `MEDIA_STANDARDS.md`; R2 multipart from the client keeps large video viable.
- **`agents` SDK churn.** Cloudflare's MCP tooling moves fast; pin versions, wrap the registration surface in one thin module (`src/mcp/`) so SDK changes stay localized. (This is containment of a moving dependency, not a premature abstraction layer — the tools themselves are still generated directly.)
- **Schema edits vs existing documents** (field removed/retyped after content exists): v1 policy — old values persist in `data_json`, hidden when undeclared, index rows dropped on next save; never destructive-migrate content. State this in `SCHEMA_ENGINE.md`.

## 9. Success criteria for v1

1. `wrangler deploy` + seed → a working, styled CMS on a workers.dev URL in under ten minutes.
2. A non-technical user can create a collection, upload media, author markdown content, and publish — entirely in the admin UI.
3. An AI agent over MCP can do everything that user just did, including defining the collection — when granted the roles to do so.
4. A developer can build a public site against the REST API using only `/api/openapi.json`.
5. Every write path — admin, REST, MCP — runs through one whitelist-validated, `authorize()`-gated pipeline; the Blogmill vulnerabilities are structurally impossible, not just avoided.
6. A least-privilege agent can draft but not publish; every action it takes — and every denial it hits — is attributed in the audit log to that agent's principal, token, and surface.
7. A fresh agent session, reading only steering, produces convention-conformant code on the first try.

---

## Revision Log

- 2026-07-04: Access control promoted from non-goal to core scope (§4): unified principal model for humans and agents, default-deny RBAC + per-item grants, witness-type enforcement, audit log. New Phase 3 inserted (later phases renumbered), decisions D15–D17 added, admin gains `/admin/access`, MCP tool listing becomes permission-aware.
- 2026-07-04: **BUILD COMPLETE — all 8 phases (0–7) landed and verified.** Final gate: 0 type errors, 0 lint, 66 unit tests, 16 Playwright e2e (incl. axe WCAG 2.1 AA on every admin page), production build OK. Two deviations, both logged: (1) media uses a dedicated `media` table rather than the documents pipeline (binary + fixed columns don't fit `data_json`) — still `authorize()`-gated on the `media` collection (see MEDIA_STANDARDS.md); (2) **D18** — MCP served as a direct streamable-HTTP JSON-RPC endpoint instead of an `agents`-SDK McpAgent on a Durable Object (contained in `src/mcp/`, per §8's SDK-churn guidance), preserving every load-bearing property. See `worklog.md` for the step-by-step record.

---

## Appendix A — Reference file map (optional, for sessions with the ref repos mounted)

**dpt-platform (`~/repos/dpt-platform`)** — the substrate template:
- `AI_NATIVE_REPO_STANDARDS.md` (root) — copy this into the new repo, Phase 0.
- `surfaces/skill-scan/CLAUDE.md` — the model for our root CLAUDE.md (map + Required Reading table).
- `surfaces/skill-scan/steering/DATASTAR_PATTERNS.md` — port near-verbatim.
- `surfaces/skill-scan/src/lib/datastar-response.ts`, `json-for-script.ts`, `datastar-chat-stream.ts` — the Datastar mechanism library.
- `surfaces/skill-scan/src/middleware/session.ts`, `src/lib/auth.ts` — sessions/scrypt/guards.
- `surfaces/skill-scan/src/lib/errors.ts` + `src/main.tsx` — error hierarchy + global wiring.
- `surfaces/skill-scan/vite.config.ts`, `wrangler.jsonc`, `.github/workflows/ci.yml` — build/deploy/CI skeleton.
- Ignore: everything under `services/`, `shared/` (stubs), voice/video/agent domain code, the taxonomy/demo systems.

**Blogmill (`~/repos/blogmill`)** — the concept ancestor (read for ideas, port nothing):
- `cms/schemas/posts.js` — the original unified field descriptor.
- `cms/router.js` + `cms/controller.js` — the two-generic-routes admin + hook pipeline (~350 lines).
- `cms/components/fields/*/controller.js` — per-field-type hooks (`fieldPreSave`/`preFieldRender`).
- `lib/init-sql.js` — schema→DDL generation.
- `globals.js`, `lib/db.js`, `cms/controller.js:117-128` — the cautionary tales (globals, identifier interpolation, mass assignment).
