# Security Standards

> **STATUS: IMPLEMENTED (in force).** The built system enforces these standards — sessions + scrypt,
> hashed scope-masked tokens, the one whitelist-validated pipeline, the invite flow (single-use
> expiring set-password tokens), Resend email delivery behind `EmailTransport` (D20 realized), and
> the per-surface CSP fork (D27) are live code. The Blogmill holes
> named below are the reason each rule exists — remill's mandate is to make them *structurally
> impossible*, not merely avoided (success criterion §5 of the brief).

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
- **Rendered markdown is sanitized by construction (C1, D23).** All markdown→HTML goes through
  `src/lib/markdown` (micromark defaults): raw HTML in the source is ESCAPED (never emitted as
  markup) and `javascript:`/`data:` link destinations are stripped. NEVER pass
  `allowDangerousHtml`, and never render user/agent content with `dangerouslySetInnerHTML` except
  through this renderer or another escaping path. The `FieldView` fallback is escaped text — a
  field type must explicitly opt in to render markup.
- **Share-link tokens follow API-token discipline (C3).** `rms_`-prefixed (never confusable with an
  `rmk_` bearer key), 32 bytes of Web-Crypto entropy, SHA-256-hashed at rest (the hash is the
  grant's `subjectId`), plaintext rendered exactly once at mint. Resolution returns the same null
  for unknown/expired/revoked (no enumeration oracle), and consumption still runs through
  `authorize()` — the token is a credential, not a bypass. Minting is gated per document by the
  `share_link` action (D26) — separately grantable, NOT agent-refused — so an agent may mint
  expiring read-only links when a human grants it that capability; identity/role/token mutations
  (`assignRole`, `issueToken`, `createUser`, `createAgent`, team CRUD) still refuse agents.
- **OAuth credentials follow the same discipline (D48).** Prefix map: `rmk_` manual bearer key ·
  `rms_` share link · `rmj_` team join · `rmo_` OAuth access token (an ordinary `api_tokens` row,
  1 h expiry, `grant_id`-cascaded) · `rmr_` OAuth refresh (hash lives on the grant row, rotated on
  every use with one-slot reuse detection) · `rmc_` auth code (60 s single-use, kept-consumed so
  replay is detectable) · `rmd_` device code. All 32 bytes Web-Crypto entropy, SHA-256-hashed at
  rest, plaintext delivered exactly once, uniform `invalid_grant` for unknown/expired/revoked (no
  enumeration oracle). Unauthenticated `/mcp` answers **401 +
  `WWW-Authenticate: Bearer resource_metadata=…`** — the challenge that drives MCP OAuth
  discovery; there is no anonymous MCP surface. The `/oauth/token`, `/oauth/register`,
  `/oauth/revoke`, and `/oauth/device-authorization` endpoints (and `/.well-known/*`, `/mcp`)
  carry permissive CORS deliberately — they authenticate by bearer/PKCE, never by cookie; the
  cookie-bearing consent pages (`/oauth/authorize`, `/oauth/device`) get none. DCR is
  unauthenticated by design (RFC 7591): rate-limited and purged when no grant follows in 7 days;
  the device user-code entry POST is login-tight (the low-entropy brute-force surface).

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
- **Authorize BEFORE any existence probe.** When a service both checks authorization and checks
  whether a resource exists, the `authorize()` call comes first — otherwise the error shape
  (Conflict/NotFound vs Forbidden) becomes an enumeration oracle for callers who hold no permission
  at all. Precedent: `installPack` authorizes every target slug before its pre-flight conflict
  checks (D42; tested in collections.test.ts "authorization precedes existence probing").

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
- **Invite / set-password tokens follow the same rules** (`invite_tokens`, `src/db/queries/invites.ts`):
  hashed at rest, shown once, **single-use** (`consumed_at`) and **expiring** (`expires_at`, 7 days).
  Consuming one is *un-gated* — the token IS the credential (identity-scoped, like `/admin/account`) — so
  it only ever lets the invitee set **their own** password. An invited human with no password gets an
  **unusable random hash** stored, so login is impossible until they set one. A missing/expired/consumed
  token must be indistinguishable to the client (no enumeration oracle). Creating an invite requires
  `manage_access` and refuses agents (SEC-8).
- **Team join links (D24) follow the same invite-token discipline** with two deliberate deltas:
  `rmj_`-prefixed, hashed at rest, plaintext shown once — but **multi-use** (optional `maxUses`)
  and expiry **required** (clamped ≤90 days), with a validated role preset (never `anonymous`).
  Acceptance (`/auth/join/:token`) is un-gated — the token IS the credential — and rate-limited at
  the login tier; an existing email raises `ConflictError`, never a silent account attach. Team
  creation/membership/invite management requires `manage_access` and refuses agents (SEC-8).
- **Email delivery (D20 realized):** `getEmailTransport(env, settings)` selects the
  `ResendEmailTransport` (plain fetch POST to the Resend API, Bearer `RESEND_API_KEY`) when a key
  and a From address exist — From precedence `settings.emailFrom` > `env.EMAIL_FROM`. The
  `ConsoleEmailTransport` stub remains the keyless/test default; it does not send and logs only
  redacted metadata (recipient *domain*, subject) — never the address, body, or link/token (PII
  discipline). Sends are **log-and-never-throw**: the actionable link is always also surfaced
  on-screen, so delivery failure never blocks a flow. Templates (`src/lib/email/templates.ts`) are
  inline-CSS with every interpolation escaped. Callers depend only on the `EmailTransport` interface.
- **Changing a password verifies the CURRENT password first** (`verifyPassword`, constant-time), and
  rejects a mismatch with a **generic** message — never reveal whether the account or the password was
  wrong. Enforce a minimum length, then re-hash. A change email/password path is scoped to the session
  principal only. Note the stateless-cookie limitation: a password change cannot revoke sessions already
  minted on other devices (documented in `services/account`; server-side revocation is post-v1).

## 5. Secrets

- **No secrets in source.** Managed as Worker bindings via `wrangler secret put <NAME>`; local dev via
  a gitignored `.dev.vars` (copy from `.dev.vars.example`). At minimum `SESSION_SECRET` (≥32 chars);
  `RESEND_API_KEY` (email, D20) follows the same rule — `.dev.vars` locally, `wrangler secret put`
  in prod, never committed.
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
- **The `html` field type (D25) is the SECOND sanctioned raw-markup exception** (the first is
  markdown, which sanitizes via micromark): `src/fields/html.tsx` renders its value VERBATIM via
  `dangerouslySetInnerHTML` into `div.rm-html`. Its trust model is **collection-level write
  permission only** (field-level access remains reserved, v1) — the field is writable over
  REST/MCP **by design**, so scope html-bearing collections to trusted roles. Do not add a third
  exception without a decision-log entry.
- Outside those two field types, **the only sanctioned `dangerouslySetInnerHTML`** is `jsonForScript` (`src/lib/json-for-script.ts`)
  for `data-signals` / bootstrap payloads — it escapes for safe inline embedding. Never
  hand-concatenate user-controlled values into a `<script>` or a `data-on:*` expression.

## 8. Response headers & abuse controls

- Set security headers on all responses: `Strict-Transport-Security`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
  Content-Security-Policy. The real policy (`src/middleware/security-headers.ts`) is
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. **`'unsafe-eval'` is a required, justified
  exception, not an oversight:** Datastar v1 compiles its `data-*` attribute expressions with the
  `Function` constructor, which CSP classifies as eval — the admin cannot run without it. `'unsafe-inline'`
  covers the theme-init snippet and the `data-signals` bootstrap. Datastar is **vendored same-origin
  (`'self'`), not loaded from a CDN.** `style-src 'self' 'unsafe-inline'` covers Tailwind; media serving
  uses `img-src 'self' data:` (publicRead assets are additionally designed for cross-origin embedding).
- **The CSP is forked per surface (D27)** in `src/middleware/security-headers.ts`:
  `PROTECTED_PREFIXES` (`/admin`, `/api`, `/mcp`, `/auth`, `/media`) always get the strict policy;
  public paths widen `script-src` to exactly `https://cdn.jsdelivr.net` + `https://unpkg.com` and
  ONLY while the `allowCdnScripts` settings toggle (default off, warning help copy) is on —
  decided by one un-gated `getSettings` PK read per public request. **Classifier caveat: it is
  prefix-based** — any new top-level protected route MUST be added to `PROTECTED_PREFIXES` or it
  silently gets the public policy. Chart.js is vendored at `public/vendor/chart.umd.js` (served
  under `'self'`), so charts work with the toggle OFF. **Intentionally public top-level routes
  (D35):** `/rss.xml`, `/sitemap.xml`, `/robots.txt`, and the `/` homepage — all read as the
  anonymous principal through the gated pipeline (published + publicRead + lifecycle only; the
  feed/sitemap can never leak a draft because the compiled read filter runs in-query), and all
  correctly receive the public CSP. robots.txt disallows every protected prefix plus `/s/`
  (share links are capability URLs — never crawlable).
- **Import (D37) is a bulk WRITE surface and is treated like one**: 10 MiB body cap
  (`MAX_IMPORT_BODY_BYTES`), its own `'import'` rate bucket (10/60s), every line through the
  whitelist-validated pipeline with per-item `authorize()`, and a publish gate — a line arriving
  with `status:'published'` requires the `publish` action, so bulk ingestion cannot smuggle
  drafts live past "agent proposes, human publishes". Foreign `createdBy` values are discarded
  (the importer is the creator); preserved ids are shape-validated (`doc_…`) before touching the
  DB. Export leaks nothing by construction: it reuses the compiled read filter in-query.
- **SEC-5 — public collection discovery is a deliberate, bounded exception** to the no-enumeration
  posture: discovery stays public (remill is agent-native), but an unauthenticated or unprivileged
  caller receives a **public-safe projection** that omits the internal `access`/`workflow` config —
  only `manage_schema` principals see the full definition. All three discovery surfaces (REST
  `/api/collections`, MCP `list_collections`, and the admin) share the one projection in
  `src/services/collections`.
- **CSRF**: `SameSite=Lax` session cookies + same-origin form/Datastar posts cover the admin. For
  state-changing non-form JS calls, require the `Datastar-Request` header or an explicit CSRF check.
  Token-authenticated REST/MCP is not cookie-authenticated, so it is not CSRF-exposed.
- **Rate-limit** abuse-prone endpoints (login, token issuance, upload, import, join) keyed on
  `CF-Connecting-IP` (edge-set, not spoofable) or principal ID. Never read `X-Forwarded-For` directly.
  The shared core is `consumeRateLimit` (src/middleware/rate-limit.ts) — the route middleware AND
  in-handler consumers (the MCP `upload_media` tool) use the same buckets; never fork a second counter.
  There is intentionally **no in-app site-wide/global tier** (D40): a `kv.put` per request exhausts
  the Cloudflare free-tier KV write budget, so volumetric abuse is left to Cloudflare's edge DDoS +
  zone WAF, and only the abuse-prone endpoints above hold their own limiters.
- **Per-surface body caps (SEC-4/D34)**: reject oversized bodies BEFORE parsing via
  `assertBodyWithinLimit`. REST JSON = 1 MiB (`MAX_JSON_BODY_BYTES`); `/mcp` = 8 MiB
  (`MAX_MCP_BODY_BYTES` — base64 upload payloads); multipart uploads = 25 MiB at the service.
  A new surface picks the smallest cap that fits its payloads — never silently inherit a larger one.

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
