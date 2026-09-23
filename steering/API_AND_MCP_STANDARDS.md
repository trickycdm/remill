# API & MCP Standards

> **STATUS: IMPLEMENTED — REST (Phase 6) + MCP (Phase 7).** Both surfaces are generated from the
> same field descriptors as the admin (surfaces 5 and 6 of the schema engine); neither maintains a
> hand-written schema or tool list. REST code: `src/routes/api/**`, `src/lib/api.ts` +
> `api-auth.ts` (bearer/scope resolution), `src/lib/openapi.ts` (generated OpenAPI 3.1). The list
> filter/sort over `document_index` lives in `src/db/queries/documents.ts` + the documents service.
> MCP code: `src/mcp/tools.ts` (permission-filtered tool generation), `src/mcp/handler.ts` (JSON-RPC
> dispatch), `src/routes/mcp.tsx`. Sharing fabric v2 added team subjects, `share_link_<slug>`, and
> `list_teams` (D24/D26).
>
> **MCP transport deviation from D10 (deliberate, per §8):** the plan specified an `McpAgent` on a
> Durable Object via the Cloudflare `agents` SDK. We instead serve MCP as a direct streamable-HTTP
> JSON-RPC endpoint. Rationale: the `agents` SDK is a §8 watch-item (fast-moving; its bearer-auth
> prop injection is version-fragile) and a stateless generated-tool server needs no DO session state.
> Every load-bearing property is preserved — tools generated from field descriptors, intersected with
> the connecting principal's permissions, routed through the shared service pipeline — and the whole
> registration surface stays in the one thin `src/mcp/` module, which is the containment §8 asks for.
> Revisit if MCP session state (elicitation, sampling) is needed. Logged as a decision below.

## Shared foundation: one pipeline, three doors

Admin, REST, and MCP write paths run through the **exact same service layer** — the same whitelist
validation (SCHEMA_ENGINE.md) and the same `authorize()` choke point (ACCESS_CONTROL.md). A behavior
that differs between surfaces is a bug unless the plan explicitly calls for it. Never add a
validation or authorization step that lives only in one surface.

## Authentication & principal resolution

- Every request resolves to a **principal** before any logic runs (ACCESS_CONTROL.md). Humans:
  session cookie. Machines (REST + MCP): **bearer token**. Unauthenticated on REST/public surfaces:
  the `anonymous` principal. Unauthenticated on **/mcp**: a **401 with
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`** —
  the challenge that triggers a client's OAuth walk (D48); there is no anonymous MCP surface.
  `GET /mcp` is a 405 (the transport is POST-only streamable HTTP, D18).
- Tokens are **hashed at rest** (never stored plaintext). On each request, hash the presented token
  and look it up; update `last_used_at`. A token maps to exactly one principal. OAuth-issued
  access tokens (`rmo_`, D48) ARE `api_tokens` rows — same resolution, listing, and revocation.
- **Token scope masks narrow, never widen.** Effective permission = principal's permissions ∩ token
  mask. Resolve this once per request and carry it on the context.
- Reject expired tokens (`expires_at`) and tokens for disabled principals with a structured 401.
- **OAuth 2.1 endpoints (D48)** — `/oauth/register` (RFC 7591 DCR, public clients only),
  `/oauth/authorize` + `/oauth/device` (session-authenticated consent, `manage_access`),
  `/oauth/token` (auth-code + PKCE S256, rotating refresh, RFC 8628 device grant),
  `/oauth/revoke` (RFC 7009), `/oauth/device-authorization`; discovery documents hand-registered
  in `main.tsx` on every client-probed alias. **The token/register/revoke/device-authorization
  responses — including errors — are raw OAuth JSON (`{error, error_description}`) via early
  returns**, never the app `{error, code}` shape and never thrown through `onError`: clients
  branch on `error` values (`authorization_pending`, `slow_down`, `invalid_grant`). This is the
  documented exception to the error contract above.

## Error & response shapes

- Validation errors return the **same Zod issue shape** the admin uses — one error contract across
  surfaces. Shape: `400 { error, code: 'VALIDATION', issues: [...] }`.
- Denials return the structured 403 from ACCESS_CONTROL.md:
  `403 { error, code: 'FORBIDDEN', missing: { action, collection } }`.
- Other failures follow ERROR_HANDLING.md: `{ error, code }` with the machine-readable code.
- Stale saves are `409 { code: 'STALE_REVISION' }` (D54). Every document read carries `revision`;
  REST exposes it as `ETag` and accepts it back as `If-Match` on PATCH, MCP `update_<slug>` takes
  it as `expectedRevision`. Any new surface that writes a document must accept the expected
  revision and pass it to the service — don't add a write path that can only overwrite blind.
- Success bodies are plain JSON — REST returns documents/collections directly, never Datastar HTML
  patches (that is the admin surface's job; keep them separate — decision from plan §2).

## REST API (Phase 6)

Routes (plan §5b): collections list/create/update; documents list/get/create/update/delete/publish;
revisions; media upload; `/media/:id[/:variant]` serving; **item-grant sharing** at
`/api/c/:collection/:id/grants` (GET list / POST grant / DELETE revoke, all `manage_access`-gated).

- **Listing** supports `?filter[field]=`, `?sort=`, `?page=`, `?status=`. Filtering and sorting are
  only allowed on **indexed** fields (those with `index: true`, present in `document_index`).
  Requesting a filter/sort on a non-indexed field returns a structured 400 — never silently ignore it.
- **Filter operators (D28)**: `?filter[field][op]=value` with `op` ∈ `eq` (default) / `gte` / `lte` /
  `contains` (text kinds only — 400 on numeric) / `in` (comma-separated, ≤20 values). Operator
  entries on one field merge into a range (`filter[views][gte]=10&filter[views][lte]=20`). Unknown
  op → 400. Caveat: `contains` sees only what `toIndex` stored — for markdown/html that is a
  200-char lead-in; use `?q=` for full text.
- **Full-text search (D28)**: `?q=` on the per-collection list runs FTS5 (words ANDed, last word
  prefix-matched, bm25-ranked — so `q` + `sort` is a 400). Response items are search hits
  `{id, collection, title, snippet, status, updatedAt}` with `hasMore` (offset paging, no total).
  The caller's compiled read filter applies in-query per collection, same as lists.
- **Permission-filtered lists**: the query applies the SQL predicates compiled by the access module
  (ACCESS_CONTROL.md). **Never post-filter in memory** — pagination counts must match the filtered
  set exactly.
- **publicRead**: a collection with `access.publicRead` allows the `anonymous` principal to GET
  **published** documents only. Drafts are never visible to anonymous, ever.
- **private (D46)**: `access.private` (mutually exclusive with `publicRead`) removes the collection
  from every **discovery** surface — `GET /api/collections[/:slug]`, MCP `list_collections`,
  `/api/openapi.json` paths+schemas, and pack `installed`-status (`list_packs` / `GET /api/packs`) —
  for callers without `manage_schema` or a role/token-scope `read` on it. `GET /api/collections/:slug`
  404s (indistinguishable from nonexistent — no enumeration oracle); the OpenAPI doc and pack status
  are **caller-scoped** (resolve the requesting principal, then `listDiscoverableCollections`). Content
  access is unchanged — private collections were already deny-by-default for anonymous.
- **Relation read-expansion (B2)**: document reads (get + list, REST and MCP alike) attach a
  `relations` object BESIDE `data` — `{ [fieldKey]: { id, title, collection } | [...] }` — resolving
  each referencing field's id(s) to the target's display title (`titleField` config, else the
  target's first text/slug field). `data` keeps the raw ids so write round-trips are unaffected.
  Titles are permission-gated: a dangling id or a target the reader cannot see expands with
  `title: null` — never an error, and never a leak (the batch load applies the reader's compiled
  filter in-query).
- **Media read-expansion (D41)**: document reads likewise attach a `media` object BESIDE `data` —
  `{ [mediaFieldKey]: { id, alt, width, height } }` — whitelisted metadata only (never `r2Key`,
  filenames, or uploader). Gated once per batch via `read` on `media`; on Forbidden the expansion
  degrades to absent rather than erroring, so a public render never 500s.
- **Backlinks (B3)**: `GET /api/c/:collection/:id/backlinks` (and the MCP `backlinks_<slug>` tool)
  lists documents that reference the given one through **indexed** relation fields —
  `[{ id, collection, title, status, updatedAt }]`. Read-gated twice: asking requires `read` on the
  target, and each SOURCE collection is queried under the caller's own compiled filter, so a
  referrer the reader cannot see is simply absent. Capped per source collection (display, not
  pagination).
- **Audit (Phase 4)**: `GET /api/audit` (and the MCP `list_audit` tool, visible with
  `manage_access`) reads the audit trail — filters `principal/action/collection/result/surface`,
  keyset `cursor` paging, newest first.
- **Trash (D29)**: `DELETE /api/c/:collection/:id` moves to trash (recoverable ~30 days), it no
  longer destroys. `GET /api/trash` lists entries across collections the caller can `delete`
  (conditions applied in-query); `POST /api/trash/:id/restore` restores under the original id
  (409 when the collection is gone or the id/unique value was re-taken);
  `DELETE /api/trash/:id` destroys permanently.
- **Scheduled publishing (D32)**: `POST /api/c/:collection/:id/schedule` with body
  `{publishAt: "<ISO-8601>" | null}` (null cancels). Publish-gated, lifecycle collections only,
  drafts only (scheduling a published doc is a 400; a past time publishes on the next per-minute
  drain). Scheduling appends NO revision (it is not an edit); document payloads carry `publishAt`
  beside `publishedAt`. The drain publishes as the system actor (surface `system` in the audit
  trail — ACCESS_CONTROL.md D30).
- **Events feed (D33)**: `GET /api/events?since=<seq>&collection=&limit=` (and the MCP
  `poll_events` tool, offered to every principal) → `{data, nextSince}`, oldest first, limit
  default 100 / cap 500. Rows are POINTERS (type, collection, resource id, actor, time — no
  payload): consumers re-fetch content via the ordinary read endpoints. Filtering is
  per-collection read capability (roles ∩ token scope, plus publicRead); narrowing to an
  unreadable collection returns an EMPTY page, never a 403 (no enumeration). Semantics callers
  must honor: pass `nextSince` back as `since`; events prune after 30 days, so **seq gaps are
  legal** and a stale `since` silently skips the pruned horizon.
- **Import/export (D37) — the NDJSON format, verbatim:** one collection per file; line 1 is
  `{"kind":"remill-export","version":1,"exportedAt":"<ISO>","collection":<full definition>}`;
  every following line is `{"kind":"document","id","status","data","createdAt","updatedAt",
  "publishedAt","createdBy"}`. `GET /api/c/:slug/export` (`application/x-ndjson`; admin download
  at `/admin/c/:slug/export`) is bounded by the caller's compiled read filter. `POST
  /api/c/:slug/import` (body cap `MAX_IMPORT_BODY_BYTES` 10 MiB — split larger imports; rate
  bucket `'import'` 10/60s; admin page `/admin/c/:slug/import`): upsert by preserved `doc_…` id
  through the FULL validated pipeline, per-item authorize; on create it preserves
  id/status/createdAt/publishedAt (updatedAt = import time, createdBy = the importer — foreign
  principal ids never survive). Lines with `status:'published'` also require the `publish`
  action (import must not bypass "agent drafts, human publishes"). The header's def slug must
  match the target; import NEVER mutates the definition. `?dryRun=1` validates without writing.
  Response `{created, updated, failed, errors:[{line, id?, error}]}` — per-line errors, the run
  never aborts. Body-cap table: REST JSON 1 MiB · /mcp 8 MiB · import 10 MiB · media multipart
  25 MiB (service cap).
- **Visibility (D50)**: `POST /api/c/:collection/:id/visibility` with body `{visibility: 'public' |
  'unlisted' | 'private'}`. Publish-gated (changing a document's exposure is a publication
  decision), allowed on drafts (remembered, takes effect on publish). Document payloads in
  list/get responses carry `visibility`.
- **Share links (D51/D53)**: `POST /api/c/:collection/:id/share-links` with body
  `{expiresAt, password?, label?}` → `201 {grantId, url, expiresAt, hasPassword, label}` (password
  never echoed back; `expiresAt` required, validated, clamped to 30 days and echoed normalized —
  `createShareLink`'s `maxTtlDays`, the same rule as the MCP tool below). `GET` lists the
  document's unexpired links (no hashes), each including `url` — the decrypted, re-copyable link
  (D53; null for a link minted before `token_enc` existed, or a decryption failure);
  `DELETE /api/c/:collection/:id/share-links/:grantId` revokes. All gated on `share_link`.
- **OpenAPI**: `/api/openapi.json` is generated from the **live** collection definitions via each
  field type's `jsonSchema` — surface (5). Never hand-write or hand-patch it; regenerate.
  Static (non-generated) endpoints like `/api/trash` must be hand-added in `staticPaths()`
  (src/lib/openapi.ts) — the generator only iterates collections. `generateOpenApi(defs, baseUrl)`
  is a pure function BELOW the services layer: the route resolves the requesting principal and passes
  `listDiscoverableCollections`, so the document is caller-scoped (private collections omitted for
  callers who can't discover them, D46) — never call it with the raw `listCollections`.
- **Rate-limit headers** are stubbed in v1 (`X-RateLimit-*` present, not enforced). Wire real limits
  post-v1.

## MCP server (Phase 7)

A direct streamable-HTTP JSON-RPC endpoint at `/mcp` (`src/mcp/handler.ts` + `tools.ts` — decision
**D18**; not an `agents`-SDK `McpAgent` on a Durable Object), authenticated with the **same bearer
tokens** as REST.

- **Tools are generated per collection** from field descriptors (surface 6), not hand-listed:
  - Per collection: `list_<slug>` (accepts a `filters` array `{field, op?, value}`, D28),
    `search_<slug>` (full-text, read-gated, plain-text snippets, D28), `get_<slug>` (when the
    collection's template declares text renders — D47 — it also accepts `render` (enum of the
    declared names) + `budget` (≈ token cap) and returns LITERAL markdown via the `McpTextResult`
    transport passthrough, never JSON-quoted; REST parity: `GET /api/c/:c/:id?render=&budget=` →
    `text/markdown`, params advertised in OpenAPI; unknown render → the standard 422 listing the
    available names),
    `backlinks_<slug>` (reverse links, read-gated), `revisions_<slug>` (read-gated, D34),
    `restore_<slug>` (update-gated — restoring a revision IS an update, D34),
    `create_<slug>`, `update_<slug>`, `delete_<slug>` (delete-gated; moves to trash,
    recoverable ~30 days — D29), `publish_<slug>`, `schedule_<slug>` (publish-gated, lifecycle
    collections only; `{id, publish_at? | cancel?}` — exactly one of the two, validated in the
    handler — D32),
    `share_<slug>` (item grant; `subjectKind: 'principal' | 'role' | 'team'`; visible only with
    `manage_access`), `share_link_<slug>` (anonymous share link, D26 — see below), and
    `visibility_<slug>` (D50 — `{id, visibility}`, publish-gated; visible when the caller could
    both `publicRead` the collection and `publish`, since visibility is meaningless on a
    non-publicRead collection), and — on collections with an `html`/`markdown` field, for callers
    who could `comment` (D55) — `comments_<slug>` (threads as JSON), `comment_<slug>` (start a
    thread: `quote` → text anchor the server locates, `blockId` → figure, neither → whole
    document), `reply_comment_<slug>`, `resolve_comment_<slug>` (`reopen: true` reopens)
    — input schemas from field types' `jsonSchema`, descriptions from collection/field labels.
  - **Document review for agents (D55):** `get_<slug>` gains `render: 'review'` on annotatable
    collections — a markdown brief of every visible thread with its quote in context
    (`…before {==quote==} after…`), author, intent, anchor state (outdated flagged), replies and
    `threadId`; open must-fix threads first, resolved last under a `budget`. It deliberately does
    not reproduce the document (the agent reads the source with `get_<slug>`). `update_<slug>`
    takes `resolves: [threadId]`, validated BEFORE the save (a bad id fails the call with nothing
    written) and resolved at the new revision after it. REST parity: `/api/c/:c/:id/comments`
    (GET/POST), `…/comments/:cid` (DELETE), `…/replies`, `…/resolve` (`{resolved:false}`
    reopens), `?render=review`. Resolving is principal-only on every surface.
  - Schema management: `list_collections`, `create_collection`, `update_collection`
    (require `manage_schema`).
  - Packs/templates (D42): `list_templates` + `list_packs` (ungated discovery — registry metadata
    is code; `installed` reveals nothing `list_collections` doesn't) and `install_pack`
    (`manage_schema`; `{pack, slug?}` — slug renames a single-collection pack's scaffold). REST
    parity: `GET /api/templates`, `GET /api/packs`, `POST /api/packs/:key/install` (201/403/409;
    static routes, hand-listed in `staticPaths()`). All surfaces call the ONE `installPack`
    service: authorize every target slug FIRST (no conflict-vs-forbidden existence oracle), then
    pre-flight all slugs (all-or-nothing), then loop `createCollection`.
  - Teams: `list_teams` (visible only with `manage_access`).
  - Media: `list_media`, `get_media_url`, and `upload_media` (D34 — base64, create-gated,
    offered only when the route threads the R2 bucket via `McpToolContext`; reuses the REST
    upload service verbatim: MIME sniffed from bytes, 25 MiB service cap, alt required for
    images; shares REST's 'upload' rate bucket keyed tokenId-else-IP). Body caps: /mcp accepts
    8 MiB (`MAX_MCP_BODY_BYTES`, ≈6 MiB effective file after base64); REST JSON stays 1 MiB;
    files beyond that use REST multipart `POST /api/media`.
  - Resources: published documents exposed as MCP resources for read-heavy clients.
  - Prompts (D44): published items of PROMPT-SHAPED collections (`def.template === 'prompt'` —
    the semantic marker, never a hard-coded slug) served via the native `prompts/list` /
    `prompts/get` primitive. Names are `<collection>/<item-slug>` (`doc_…` id fallback);
    arguments derive from the item's declared-∪-scanned `{{variables}}` (`lib/prompt-shape.ts`,
    the same contract the `prompt` reading template renders); interpolation is split/join
    (never `String.replace` — `$&`-safe), missing args stay verbatim (all args optional).
    Discovery is permission-filtered via the same `couldDo` intersection as tools; reads go
    through the document services (authorize + compiled filter). Single-page list (`cursor`
    ignored, `nextCursor` omitted — spec-compliant). Unknown/unpublished/non-prompt/forbidden
    all map to ONE `-32602` shape — no existence oracle. `listChanged` deliberately not
    declared (no push channel; clients poll).
- **`share_link_<slug>` (D26/D51)** mints an anonymous share link for one document. Visibility and
  gating key on the `share_link` action — not `manage_access`, and not agent-refused. The grant is
  read-only (`actions: ['read']` hardcoded); `expiresAt` is REQUIRED and clamped to 30 days; the
  tool returns `{ grantId, url, expiresAt, hasPassword, label }`. Optional `password` (min 8 chars,
  hashed, never echoed back) and `label` (trimmed, max 80 chars) args, D51. The plaintext URL
  **intentionally enters agent context** — the grant is revocable at any time from the Share panel
  or the access matrix; a password (delivered out of band) still gates the human recipient.
- **Absolute URLs come from `resolveBaseUrl`** (`src/lib/base-url.ts`: `env.BASE_URL` >
  `settings.siteUrl` > request origin), threaded route → `handleMcp` → `buildToolsForPrincipal`, so
  URL-minting tools never hand-build an origin. Admin share/invite links use the same resolver.
- **Permission-filtered tool listing**: the registered tool set is intersected with the connecting
  principal's effective permissions. An agent without `publish` **never sees** `publish_<slug>`.
  Capability discovery IS permission discovery — this keeps agents from planning actions they can't
  take.
- Tool registration **re-derives per session** from the `collections` table and the principal's
  permissions, so schema and access changes are visible to agents without a redeploy.
- **Tool naming rule**: `<verb>_<slug>` with the collection slug verbatim. Slugs are validated
  (`^[a-z][a-z0-9_]*$`) so tool names are always valid MCP identifiers.
- **SDK containment**: all `agents`-SDK contact lives in one thin module (`src/mcp/`). The SDK moves
  fast (risk in plan §8) — pin the version, wrap the registration surface so churn stays localized.
  This is containment of a moving dependency, **not** a premature abstraction — tools are still
  generated directly from definitions, not routed through a tool-framework indirection (dpt built one
  and deleted it — do not repeat that).

## Non-negotiables

- No surface bypasses `authorize()` or the whitelist. If you're writing a document without going
  through the documents service, stop.
- No shared/team tokens. Every token belongs to one principal (ACCESS_CONTROL.md).
- Denials are structured and actionable (`missing: { action, collection }`) on all three surfaces.
