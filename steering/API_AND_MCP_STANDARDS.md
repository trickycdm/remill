# API & MCP Standards

> **STATUS: IMPLEMENTED — REST (Phase 6) + MCP (Phase 7).** Both surfaces are generated from the
> same field descriptors as the admin (surfaces 5 and 6 of the schema engine); neither maintains a
> hand-written schema or tool list. REST code: `src/routes/api/**`, `src/lib/api.ts` +
> `api-auth.ts` (bearer/scope resolution), `src/lib/openapi.ts` (generated OpenAPI 3.1). The list
> filter/sort over `document_index` lives in `src/db/queries/documents.ts` + the documents service.
> MCP code: `src/mcp/tools.ts` (permission-filtered tool generation), `src/mcp/handler.ts` (JSON-RPC
> dispatch), `src/routes/mcp.tsx`.
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
  session cookie. Machines (REST + MCP): **bearer token**. Unauthenticated: the `anonymous` principal.
- Tokens are **hashed at rest** (never stored plaintext). On each request, hash the presented token
  and look it up; update `last_used_at`. A token maps to exactly one principal.
- **Token scope masks narrow, never widen.** Effective permission = principal's permissions ∩ token
  mask. Resolve this once per request and carry it on the context.
- Reject expired tokens (`expires_at`) and tokens for disabled principals with a structured 401.

## Error & response shapes

- Validation errors return the **same Zod issue shape** the admin uses — one error contract across
  surfaces. Shape: `400 { error, code: 'VALIDATION', issues: [...] }`.
- Denials return the structured 403 from ACCESS_CONTROL.md:
  `403 { error, code: 'FORBIDDEN', missing: { action, collection } }`.
- Other failures follow ERROR_HANDLING.md: `{ error, code }` with the machine-readable code.
- Success bodies are plain JSON — REST returns documents/collections directly, never Datastar HTML
  patches (that is the admin surface's job; keep them separate — decision from plan §2).

## REST API (Phase 6)

Routes (plan §5b): collections list/create/update; documents list/get/create/update/delete/publish;
revisions; media upload; `/media/:id[/:variant]` serving; **item-grant sharing** at
`/api/c/:collection/:id/grants` (GET list / POST grant / DELETE revoke, all `manage_access`-gated).

- **Listing** supports `?filter[field]=`, `?sort=`, `?page=`, `?status=`. Filtering and sorting are
  only allowed on **indexed** fields (those with `index: true`, present in `document_index`).
  Requesting a filter/sort on a non-indexed field returns a structured 400 — never silently ignore it.
- **Permission-filtered lists**: the query applies the SQL predicates compiled by the access module
  (ACCESS_CONTROL.md). **Never post-filter in memory** — pagination counts must match the filtered
  set exactly.
- **publicRead**: a collection with `access.publicRead` allows the `anonymous` principal to GET
  **published** documents only. Drafts are never visible to anonymous, ever.
- **OpenAPI**: `/api/openapi.json` is generated from the **live** collection definitions via each
  field type's `jsonSchema` — surface (5). Never hand-write or hand-patch it; regenerate.
- **Rate-limit headers** are stubbed in v1 (`X-RateLimit-*` present, not enforced). Wire real limits
  post-v1.

## MCP server (Phase 7)

A direct streamable-HTTP JSON-RPC endpoint at `/mcp` (`src/mcp/handler.ts` + `tools.ts` — decision
**D18**; not an `agents`-SDK `McpAgent` on a Durable Object), authenticated with the **same bearer
tokens** as REST.

- **Tools are generated per collection** from field descriptors (surface 6), not hand-listed:
  - Per collection: `list_<slug>`, `get_<slug>`, `create_<slug>`, `update_<slug>`, `publish_<slug>`,
    `share_<slug>` (item grant; visible only with `manage_access`)
    — input schemas from field types' `jsonSchema`, descriptions from collection/field labels.
  - Schema management: `list_collections`, `create_collection`, `update_collection`
    (require `manage_schema`).
  - Media: `list_media`, `get_media_url`.
  - Resources: published documents exposed as MCP resources for read-heavy clients.
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
