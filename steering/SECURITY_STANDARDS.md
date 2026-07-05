# Security Standards

> **STATUS: TARGET.** remill has no code yet. These standards bind every line written from Phase 1 on.
> The Blogmill holes named below are the reason each rule exists — remill's mandate is to make them
> *structurally impossible*, not merely avoided (success criterion §5 of the plan).

remill descends from Blogmill, whose implementation shipped real security holes: **mass assignment of
the whole request body**, unescaped SQL identifiers, and a shared weak signing secret. Every rule here
closes one of those, or a class like it. New code must comply; fix violations as encountered.

## Principles

- **Defense in depth.** Independent layers: session/token middleware → route guard → service
  authorization (`authorize()`) → storage constraints. No single layer is trusted alone.
- **Fail closed.** Deny by default. Missing auth → 401; denied → 403; invalid input → 422; unknown →
  500 with a generic message. Never fail open.
- **Least privilege.** Secrets live only in server-side Workers bindings. No client-side data access.
  A new principal (human or agent) can do nothing until granted a role — see ACCESS_CONTROL.md.
- **Server-side trust boundary.** Never trust client input for identity or authority.
- **Validate at boundaries.** All external input is Zod-validated with length/array bounds before it
  reaches business logic. Unbounded strings/arrays are DoS and prompt-injection vectors.
- **Parameterized queries only.** Drizzle builds prepared statements; values are never
  string-interpolated into SQL. No raw `sql` template with unsanitised user input, and **never
  interpolate an identifier** (table/column) from user input — that was a Blogmill hole.

## 1. Whitelist validation on EVERY write path (the anti-mass-assignment rule)

**This is the single most important security rule in remill.** Blogmill saved the entire request body
onto the record — any field an attacker named got written. remill's fix, from the schema engine:

- On every document write — **admin, REST, and MCP** — build the Zod validator from the collection's
  **field descriptors** and validate **only declared fields**. Undeclared keys are **rejected**, not
  silently stripped (reject so agents learn the schema).
- This is **one pipeline, three doors.** There is no second validation path. A surface that builds its
  own ad-hoc validator is a bug — route it through the engine's save pipeline (see SCHEMA_ENGINE.md).
- The guarantee is backed by property tests (undeclared field ⇒ always rejected) — see
  TESTING_AND_VERIFICATION.md. Never bypass the whitelist "just for an internal call."

## 2. Authorization lives in services — D1 has no RLS

- D1 is SQLite: **no row-level security, no `auth.uid()`, no service role.** All authorization is in
  TypeScript, at the service layer, through the single `authorize()` choke point in `src/access/`.
- **`authorize()` is the only place an allow/deny is computed.** Admin, REST, and MCP pass through it.
  Bypass is a **compile error**: document read/mutate queries require a `Grant` witness only the access
  module can construct. The full model, witness type, and compiled list filters are in
  ACCESS_CONTROL.md — this doc does not restate them.
- **Never post-filter lists in memory.** The access module compiles permissions into SQL predicates
  applied inside the query; in-memory filtering leaks unreadable rows through pagination and miscounts.

## 3. Roles come from the session/token, never from the client

- A human's role is resolved at login and carried in the **encrypted session cookie**
  (`hono-sessions`). An agent's is resolved from its **bearer token → principal** on each request.
- Permission resolution happens **once per request**, is carried on the request context, and is
  **never read from client input** — no role-in-body, no role-in-header, no role-in-cookie-payload.
- `manage_access` is held by humans by default; agents cannot escalate themselves or each other
  (ACCESS_CONTROL.md).

## 4. Credential & token handling

- **Passwords: scrypt via `@noble/hashes`** (`src/lib/password.ts`), RFC 7914, random per-password
  salt. Store `saltHex:hashHex`. Parameters chosen to balance strength against the Workers CPU limit
  (N=16384, r=8, p=1, dkLen=32). Never store plaintext, never log a password, never return one.
- **API tokens are hashed at rest — never store the plaintext token.** Store only a hash of the token
  in `api_tokens.token_hash`; show the plaintext to the issuer exactly once, at creation. Look up a
  presented token by hashing it and matching. A leaked database must never yield usable tokens.
- Tokens belong to a **principal** and carry an optional narrowing scope mask (∩ only, never widens) —
  ACCESS_CONTROL.md.

## 5. Secrets

- **No secrets in source.** Managed as Worker bindings via `wrangler secret put <NAME>`; local dev via
  a gitignored `.dev.vars` (copy from `.dev.vars.example`). At minimum `SESSION_SECRET` (≥32 chars).
- Never embed a secret in rendered HTML or a log line. There is no client-bundle secret convention —
  any value reaching the browser is server-rendered or a non-secret data attribute.

## 6. Uploads — sniff the bytes, never trust the extension

- **Determine media type by MIME sniffing the file content**, not by trusting the filename extension
  or the client-sent `Content-Type`. A `.jpg` that sniffs as HTML is rejected. Validate against an
  allowlist of permitted types before writing to R2.
- Full upload contract (size limits, multipart threshold, allowlist, R2 key scheme, range serving,
  alt-text-required) → **MEDIA_STANDARDS.md (Phase 5).**

## 7. Output encoding

- **Hono JSX auto-escapes** all interpolated values — the default renderer is safe. Never hand-build
  HTML strings from user content.
- **Markdown** content is parsed server-side and **sanitised** before rendering (agents and untrusted
  users author Markdown). Never render raw user Markdown as HTML.
- **The only sanctioned `dangerouslySetInnerHTML`** is `jsonForScript` (`src/lib/json-for-script.ts`)
  for `data-signals` / bootstrap payloads — it escapes for safe inline embedding. Never
  hand-concatenate user-controlled values into a `<script>` or a `data-on:*` expression.

## 8. Response headers & abuse controls

- Set security headers on all responses: `Strict-Transport-Security`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
  Content-Security-Policy. The real policy (`src/main.tsx`) is
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. **`'unsafe-eval'` is a required, justified
  exception, not an oversight:** Datastar v1 compiles its `data-*` attribute expressions with the
  `Function` constructor, which CSP classifies as eval — the admin cannot run without it. `'unsafe-inline'`
  covers the theme-init snippet and the `data-signals` bootstrap. Datastar is **vendored same-origin
  (`'self'`), not loaded from a CDN.** `style-src 'self' 'unsafe-inline'` covers Tailwind; media serving
  uses `img-src 'self' data:` (publicRead assets are additionally designed for cross-origin embedding).
- **SEC-5 — public collection discovery is a deliberate, bounded exception** to the no-enumeration
  posture: discovery stays public (remill is agent-native), but an unauthenticated or unprivileged
  caller receives a **public-safe projection** that omits the internal `access`/`workflow` config —
  only `manage_schema` principals see the full definition. All three discovery surfaces (REST
  `/api/collections`, MCP `list_collections`, and the admin) share the one projection in
  `src/services/collections`.
- **CSRF**: `SameSite=Lax` session cookies + same-origin form/Datastar posts cover the admin. For
  state-changing non-form JS calls, require the `Datastar-Request` header or an explicit CSRF check.
  Token-authenticated REST/MCP is not cookie-authenticated, so it is not CSRF-exposed.
- **Rate-limit** abuse-prone endpoints (login, token issuance, upload) keyed on `CF-Connecting-IP`
  (edge-set, not spoofable) or principal ID. Never read `X-Forwarded-For` directly.

## 9. AI / agent safety

- Every agent principal is least-privilege and audited; its bearer token is revocable and scope-masked.
  An agent without `publish` never even sees the publish tool (ACCESS_CONTROL.md).
- Treat all model/agent input as untrusted — it can never override system instructions, and model
  output is **never executed as code or SQL**. MCP tools are constrained to generated
  collection operations; no filesystem, network, or code-execution tools are registered.

## Verification

For any change touching auth, input, or data exposure: writes go through the field-descriptor
whitelist; role read from session/token not client; every sensitive read/write passes `authorize()`;
tokens and passwords hashed at rest; input length-bounded and Zod-validated; no secrets or PII in
source or logs; output escaped; uploads sniffed not extension-trusted.
