# Technical Decisions — remill

> The seeded decision log (an ADR-style record). Seeded from the build plan §6. Add a new numbered row
> when a load-bearing decision is made or changed; never rewrite history in place — supersede with a new
> entry that references the old one. The policy-model watch-items (plan §8) require a decision-log entry
> before the closed action vocabulary or condition enum is extended.

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
| D18 | MCP served as a direct streamable-HTTP JSON-RPC endpoint, NOT an McpAgent on a Durable Object (supersedes the transport half of D10) | The `agents` SDK is a §8 churn watch-item with version-fragile bearer-auth prop injection; a stateless generated-tool server needs no DO session state. All load-bearing properties (tools generated from descriptors, permission-filtered, shared service pipeline) are preserved, contained in `src/mcp/`, and unit-tested | Cloudflare `agents` McpAgent on a DO (D10's original — deferred; revisit if MCP session state like elicitation/sampling is needed) |
