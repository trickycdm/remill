# Agent Connect: OAuth 2.1 for MCP + Connect Wizard + Access Simplification (D48)

> **STATUS: IMPLEMENTED (2026-07-23, branch `feat/agent-connect-oauth`).** All six phases built and
> verified — 522+ unit/integration tests green including the 10-step OAuth walk driven through the
> real app, plus new e2e specs (wizard flow, consent screen). See the Revision Log at the bottom for
> the deviations from this plan as written.

## Context

Connecting an agent to remill today is clunky: create a machine principal on `/admin/access`, assign
a role (separate form, page reload), mint a token (third form), then hand-edit `.mcp.json` or craft a
`claude mcp add --header` command with zero guidance. Web clients (claude.ai custom connectors,
ChatGPT connectors) **cannot connect at all** — they don't support custom headers.

Fix, in one release (v1.10.0, one PR, decision **D48**):

1. **Tier 1 — Connect wizard + per-client cards**: `/admin/access/connect` collapses
   principal + role + token into one atomic step and renders paste-ready setup snippets/deep links
   for Claude Code, `.mcp.json`, Cursor, VS Code, Gemini CLI, and curl.
2. **Tier 2 — OAuth 2.1 authorization server** (the MCP authorization spec, 2025-06-18 revision):
   any MCP client connects by URL alone — `/mcp` 401-challenges, client discovers metadata, runs
   DCR + PKCE auth-code flow, admin approves on a consent screen choosing a role, remill
   auto-creates the agent principal + token. No per-vendor integrations; the clients already
   implement the client side.
3. **Tier 3 — Device-code pairing** (RFC 8628) for headless/SSH environments.
4. **Access index simplification**: `/admin/access` becomes a directory (connect CTA, slimmed
   cards, connection-health lines), not a wall of forms.

**User decisions (locked)**: consent screen default role = **Editor** (admin excluded from consent —
full-admin agents go through the wizard); anonymous `/mcp` is **dropped** (401 challenge; anonymous
published reads remain on REST/public pages); **one PR**.

## Core architecture (the elegant bit)

**OAuth access tokens are ordinary `api_tokens` rows** — new plaintext prefix `rmo_`, short
`expires_at`, new nullable `grant_id` column. `resolvePrincipal` (`src/lib/api-auth.ts:29`),
`findTokenByHash`, `stampTokenUsed`, admin token listing, and `revokeToken` all work unchanged.

**SEC-8 refinement (goes in D48 + ACCESS_CONTROL.md)**: the invariant becomes *"issuance authority
is always a recorded human consent."* Two moments:
- **Privilege decision** = consent approval. Human-only (`refuseAgentEscalation` +
  `authorize('manage_access', ROOT)` — the identical gate as `issueToken`), audited, materialized as
  an `oauth_grants` row = the capability ceiling (agent principal + role + refresh expiry).
- **Credential re-derivation** = `/oauth/token` exchanges (code/refresh/device). Re-cut short-lived
  tokens strictly *inside* the ceiling via a dedicated witness-free oauth service (D32
  system-actor precedent). The service structurally has no code path touching `principal_roles`,
  roles, or scope, and never calls the `manage_access`-gated `issueToken`.
- **Revocation** = delete the grant row → FK cascade kills all access tokens + refresh in one write.
  Auth-code replay and refresh-token reuse both kill the chain.

---

## Phase 1 — Schema + crypto lib

**`src/db/schema.ts`** — 4 new tables + 1 column (migration via `bun run db:generate`, then
hand-review: add CHECKs + indexes drizzle omits; house rules: prefixed-nanoid PKs, ISO-8601 TEXT
timestamps, NOT NULL default, index FKs; template = `team_invites`):

- `oauth_clients` — DCR registrations. `id` (`ocl_`, doubles as public client_id — nanoid is
  unguessable), `name`, `redirect_uris_json`, `token_endpoint_auth_method` (CHECK `= 'none'` —
  public clients only, structurally no secret column), `metadata_json`, `created_at`.
- `oauth_grants` — the durable consent. `id` (`ogr_`), `client_id` FK cascade, `principal_id` FK
  cascade (the agent), `granted_by` (human attribution), `role` (slug chosen at consent),
  `resource`, `refresh_token_hash` (SHA-256, rotated in place), `prev_refresh_token_hash`
  (one-slot reuse detection), `refresh_expires_at` (sliding), `created_at`, `last_used_at`.
  UNIQUE(`client_id`) — one grant per registration → reconnection reuses the principal.
  UNIQUE(`refresh_token_hash`).
- `oauth_codes` — auth codes, 60 s single-use. `id` (`oco_`), `code_hash` UNIQUE, `grant_id` FK
  cascade, `redirect_uri` (exact re-match at /token), `code_challenge`,
  `code_challenge_method` CHECK `= 'S256'`, `resource`, `expires_at`, `consumed_at` (kept so replay
  is detectable → kill grant's tokens), `created_at`.
- `oauth_device_codes` — RFC 8628. `id` (`odc_`), `device_code_hash` UNIQUE (high-entropy `rmd_`),
  `user_code_hash` UNIQUE (low-entropy → rate-limited entry), `client_id` FK cascade, `resource`,
  `grant_id` FK cascade nullable (set on approval), `denied_at`, `last_polled_at` (slow_down),
  `expires_at` (10 min), `created_at`.
- `api_tokens` + `grant_id TEXT REFERENCES oauth_grants(id) ON DELETE CASCADE` (nullable) + index.

**`src/lib/id.ts`** — `ID_PREFIX` entries: `oauthClient: 'ocl'`, `oauthGrant: 'ogr'`,
`oauthCode: 'oco'`, `oauthDevice: 'odc'`.

**`src/lib/token.ts`** — export the private `base64url()`; generators for prefixes `rmo_` (access),
`rmr_` (refresh), `rmc_` (auth code), `rmd_` (device code) — same 32-random-bytes pattern as `rmk_`.

**`src/lib/oauth.ts`** (new) — pure functions + unit tests: PKCE S256 verify
(`base64url(SHA256(verifier)) === challenge`, RFC 7636 test vectors), redirect-URI validation
(https allowed; http only loopback `127.0.0.1`/`[::1]`/`localhost` with exact-except-port match per
RFC 8252 §7.3; custom schemes allowed except `http/https/javascript/data/file/blob` — VS Code needs
this; reject fragments/wildcards/empty), user-code generator (8 chars, unambiguous
consonant/digit alphabet, compared normalized), `oauthError()` JSON helper, `WWW-Authenticate`
header builder.

**`src/config/oauth.ts`** (new) — lifetimes: access **1 h**, refresh **30 d sliding**
(rotate-on-use), auth code **60 s**, device code **10 min** / poll interval **5 s**;
unconsented-client purge window **7 d**.

## Phase 2 — Queries + services

**`src/db/queries/oauth.ts`** (new, sole Drizzle toucher) — client/grant/code/device CRUD;
`createGrantWithPrincipal` via `db.batch` (the `createUserPrincipal` atomicity precedent: insert
`principals` kind `agent` + `principal_roles` + `oauth_grants` + `oauth_codes` in one batch);
`insertGrantAccessToken` (or extend `principals.insertToken` with optional `grantId`);
`deleteTokensForGrant` (≤1 live access token per grant); refresh rotate/reuse-detect; purge queries.
Unit-test cascades explicitly (delete grant → tokens gone; delete principal → grant gone).

**`src/services/oauth/index.ts`** (new) —
- `registerClient` (DCR: validate redirect URIs, sanitize metadata, default name "MCP client").
- `validateAuthorizeRequest` → `{clientName, redirectHost, params}` (never redirect on
  client_id/redirect_uri failure; other param errors redirect with `error=` + `state`).
- `approveAuthorization(db, principal, {params, role})` — `refuseAgentEscalation` +
  `authorize('manage_access', ROOT)` (**the** audit row), then: existing grant for this client_id →
  reuse the agent principal (update role assignment if changed, null refresh hashes, fresh code);
  else `createGrantWithPrincipal` (principal named `"{client_name} — Jul 2026"` style). Must NOT
  call `createAgent`/`assignRole`/`issueToken` (double-gating/double-audit). Roles offered:
  system minus `admin`+`anonymous`, plus custom roles. Consent default **editor**.
- `denyAuthorization` → `error=access_denied` redirect URL.
- `exchangeAuthorizationCode` — hash lookup; unexpired + unconsumed + client_id match +
  redirect_uri exact + PKCE verify; mark consumed; mint pair. All failures → `invalid_grant`
  (no oracle). Replay of consumed code → delete grant's access tokens.
- `refreshGrant` — rotate-on-use; `prev_refresh_token_hash` match = theft → null hashes + delete
  access tokens → `invalid_grant`; check expiry, client_id, **`isPrincipalActive`** (disabled
  agent's refresh must die); delete old access tokens, mint pair, stamp `last_used_at`.
- `startDeviceAuthorization` / `approveDeviceCode` / `exchangeDeviceCode` — RFC 8628 states:
  `authorization_pending` / `slow_down` (< 5 s since `last_polled_at`) / `access_denied` /
  `expired_token`; approval reuses the same consent core.
- `revokeOAuthToken` (RFC 7009 — claude.ai calls it on disconnect), `revokeGrant`,
  `purgeOAuthArtifacts`, `authorizationServerMetadata(base)` / `protectedResourceMetadata(base)`.
- **`connectAgent(db, principal, {name, role, collection, scope}, now)`** — lives in
  `src/services/access/index.ts` (it's wizard, not OAuth): gated like `issueToken`, one `db.batch`
  creating principal + role assignment + token; returns `{principalId, token}`.

## Phase 3 — Routes + wiring

**File-based** (`bun run routes` regenerates `src/router.ts`; no dots so all fine):
- `src/routes/oauth/register.tsx` — POST, rate-limited.
- `src/routes/oauth/authorize/index.tsx` — GET consent / POST decision (details below).
- `src/routes/oauth/token.tsx` — POST, form-encoded. **Errors are raw OAuth JSON
  `{error, error_description}` at 400 via early returns — never thrown through `onError`**
  (clients branch on `error` values: `authorization_pending`, `slow_down`, `invalid_grant`…).
- `src/routes/oauth/revoke.tsx`, `src/routes/oauth/device-authorization.tsx`,
  `src/routes/oauth/device/index.tsx` (user-code entry + consent, prefill from `?code=`).

**Hand-registered in `src/main.tsx`** before `loadRoutes` (dotted paths can't be file-based —
existing pattern at main.tsx:101-148 for openapi.json/rss/sitemap/robots):
- `GET /.well-known/oauth-protected-resource` **and** `/.well-known/oauth-protected-resource/mcp`
  (clients path-insert per MCP spec — serve both): `{resource: "<base>/mcp",
  authorization_servers: ["<base>"], bearer_methods_supported: ["header"]}`.
- `GET /.well-known/oauth-authorization-server` (+ `/mcp` suffix alias +
  `/.well-known/openid-configuration` alias — some SDKs fall back to it): issuer, authorize/token/
  register/device-authorization/revocation endpoints, `response_types ["code"]`,
  `grant_types ["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:device_code"]`,
  `code_challenge_methods ["S256"]`, `token_endpoint_auth_methods ["none"]`. Base via
  `resolveBaseUrl(c.env, await getSettings(db), c.req.url)`.
- **Scope posture**: omit `scopes_supported`; accept + echo `scope` verbatim (Gemini expects the
  echo) but ignore it for authorization — privilege comes only from the consented role. `resource`
  (RFC 8707): if present must equal `<base>/mcp` else `invalid_target`; never required.

**`src/routes/mcp.tsx`**:
- No `Authorization` header, or `resolvePrincipal` throws `UnauthorizedError` → **401 JSON with
  `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"`**
  (+ `error="invalid_token"` when a token was presented). In-route, not `onError` (needs
  `resolveBaseUrl`). Anonymous /mcp is gone (user-approved).
- New `onRequestGet` → **405** with `Allow: POST`.

**`src/main.tsx`** — CORS (hono/cors, `origin: *`, no credentials — these endpoints are
bearer/PKCE-protected, never cookie-authenticated): `/.well-known/*` (GET), `/oauth/register`,
`/oauth/token`, `/oauth/revoke`, `/oauth/device-authorization`, and `/mcp` (POST + preflight;
`allowHeaders: Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version`;
`exposeHeaders: WWW-Authenticate`). **No CORS** on `/oauth/authorize` / `/oauth/device`
(cookie-bearing navigations).

**`src/middleware/security-headers.ts`** — add `'/oauth'` to `PROTECTED_PREFIXES`.

**`src/middleware/rate-limit.ts`** — tiers: `OAUTH_REGISTER_RATE_LIMIT` 10/60 (DCR is
unauthenticated), `OAUTH_TOKEN_RATE_LIMIT` 30/60 (device polling 12/min must fit), user-code POST
at `LOGIN_RATE_LIMIT`-style 10/60 (the low-entropy brute-force surface), device-authorization at
`TOKEN_RATE_LIMIT`.

**`src/jobs/index.ts`** — append `purgeOAuthArtifacts` to the existing `DAILY_MAINTENANCE` array
(no new cron expression / wrangler.jsonc change): expired/consumed codes, expired device codes,
expired `rmo_` rows, unconsented clients > 7 d, grants with refresh expired > 30 d (cascade).

### Consent screen (`/oauth/authorize`, AuthShell — model: `src/routes/auth/set-password/[token].tsx`)

- **GET, session check in-route** (do NOT let `requireAuth()` throw — global `onError` builds the
  login redirect from `c.req.path` only and would **drop the OAuth query string**):
  `c.redirect('/admin/login?redirect=' + encodeURIComponent(path + '?' + query))`; existing
  `safeRedirect` accepts it.
- States: (1) invalid client_id/redirect_uri → error card, **never redirect** (open-redirect
  protection); other param errors → redirect with `error=` + `state`. (2) signed-in without
  `manage_access` → "ask an administrator" card + "sign in with a different account" link.
  (3) happy path: "**{clientName}** wants to access your remill" (clientName is untrusted DCR
  input — render only as JSX text children, clamp ~64 chars; page is deliberately Datastar-free),
  mono muted "will return you to {redirectHost}", role radios (Reader/Author/Editor + custom;
  default **Editor**; each with description line), **native form POST** → 303 to the external
  callback (`dsRedirect` is same-origin-only idiom; native = works with zero JS). Approve primary /
  Deny ghost. Caption: "Approving creates an agent named "{clientName}" under Access. You can
  revoke it there any time."
- `/oauth/device` GET/POST: same shell — code entry form → same consent core → "return to your
  terminal" success page.

## Phase 4 — Connect wizard + per-client cards (Tier 1)

**`src/lib/connect-snippets.ts`** (new, pure + unit-tested) — builders taking `(baseUrl, token)`:
1. Claude Code: `claude mcp add --transport http remill <base>/mcp --header "Authorization: Bearer <token>"`
2. `.mcp.json`: `{"mcpServers":{"remill":{"type":"http","url":"<base>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`
   — byte-identical with the marketing `AgentQuickstart` block (unify: marketing uses the
   `<token>` placeholder variant of the same builder).
3. Cursor: deep link `cursor://anysphere.cursor-deeplink/mcp/install?name=remill&config=<base64(JSON)>`
   + `~/.cursor/mcp.json` fallback. Caution line: deep link embeds the token.
4. VS Code: `vscode:mcp/install?<urlencoded JSON>` + `code --add-mcp '<json>'` CLI alternative.
5. Gemini CLI: `gemini mcp add --transport http remill <base>/mcp --header "Authorization: Bearer <token>"`.
6. curl: `curl -H "Authorization: Bearer <token>" "<base>/api/collections"` (+ per-collection).
Plus an OAuth callout card (post-OAuth it's affirmative): "Browser clients (claude.ai, ChatGPT):
no token needed — paste `<base>/mcp` and approve in your browser."

**`src/components/connect-cards.tsx`** (new) — `ConnectCards` (radio-group tabs via
`data-bind` signal + `data-show` panels — no Tab component exists; per-instance signal names) and
**`SecretReveal`** extracted from the tokens.tsx:82-100 copy idiom
(`data-signals={jsonForScript(...)}`, `<code id>`, `navigator.clipboard.writeText(...)`,
Copy↔Copied! via `data-show`). Adopt `SecretReveal` in `tokens.tsx` + `users.tsx` (no behavior
change). Token/base interpolate into JSX **text** only, never `data-on` expressions.

**`src/routes/admin/access/connect/index.tsx`** (new) — GET: `requireAuth()`, AdminShell
`current="access"`, breadcrumb Access → Connect an agent. Single form (no multi-step):
client select (pre-fills name via `data-on:change` over closed option values until user edits —
`nameDirty` signal) → name → role radios (system minus anonymous, admin last with caution;
default editor) → collection select (`*` default) → `<details>` Advanced: `ScopePicker` with
`TOKEN_SCOPE_PRESETS` (moves here from the index), default **full** (= inherit role; narrowing is
the advanced move now that role carries the permission choice). POST (rate-limited
`TOKEN_RATE_LIMIT`): calls `connectAgent` → 200 fragment replacing `#connect-flow`: `Stamp
tone="affirm"`, `SecretReveal`, `ConnectCards initial={clientSlug}`, back/connect-another links.
One-time invariant holds: token exists only in this fragment. Errors → 200 `#connect-error`
alert fragment, form intact.
**Reconnect mode**: `?for=<principalId>` — fixed name, mints for the existing principal via
`issueToken` only; this is what lets the index drop per-card mint forms.

## Phase 5 — Access index restructure

**`src/routes/admin/access/index.tsx`**:
- `PageHeader` `actions` slot = the one primary Button: "Connect an agent" → `/admin/access/connect`.
- **Remove**: the roles grid (duplicate of `/admin/access/roles` — link suffices), the "New machine
  identity" form, the per-card token-issue form + ScopePicker + `#token-reveal-*` slots (replaced
  by "New token →" `/admin/access/connect?for=<id>` on machine cards).
- **Keep**: role badges + assign (collapse assign into `<details>`), token list (name · last-used ·
  revoke), audit log, invite-a-person (moved behind `<details>` in the People group header).
- **Connection-health line** on machine cards from `max(tokens[].lastUsedAt)` via existing
  `src/lib/relative-time.ts`: green dot + "Connected · last used 2m ago" / warning dot + "Never
  connected — check your client config" + "view setup →" / muted "No token yet — connect it →".
  Color always paired with text (a11y). Replace raw `lastUsedAt.slice(0,16)` in token lists too.
- OAuth-connected agents appear in the same Agents group with `<Badge tone="neutral">via OAuth</Badge>`
  (grant lookup by principal id); grant revocation surfaced as the card's revoke path for OAuth
  agents (revoke grant = cascade tokens).
- Empty-state hints → "Connect an agent to get started →".
- `agents.tsx` POST route: delete once index form is gone and e2e migrated.

## Phase 6 — Docs + marketing

- `docs/TECH_DECISIONS.md` — **D48** row: OAuth 2.1 AS for MCP; SEC-8 refined to "issuance
  authority is always a recorded human consent" (grant = ceiling; token endpoint re-derives within
  it; revocation cascades); anonymous /mcp dropped in favor of the 401 challenge; scope parameter
  accepted-and-ignored (role chosen at consent is the authority); device pairing; connect wizard.
- `steering/ACCESS_CONTROL.md` (SEC-8 wording + grant model), `steering/SECURITY_STANDARDS.md`
  (new token prefixes, challenge behavior), `steering/API_AND_MCP_STANDARDS.md` (OAuth endpoints,
  error-shape exception for /oauth/token).
- `src/components/marketing.tsx` `AgentQuickstart`: coupon 1 → "Sign in and hit **Connect an
  agent**…"; add the URL-only OAuth path ("Paste `https://your.remill/mcp` into any MCP client and
  approve it in your browser"); `.mcp.json` block from the shared snippet builder.
- `CLAUDE.md` build-status note (post-merge).

## Verification

**Unit (vitest, `createTestD1` — real migrations apply in-memory)**:
- `src/lib/oauth` PKCE vectors (RFC 7636 appendix B), redirect-URI matrix, user-code shape.
- `src/db/queries/oauth`: batch creation, cascade tests (grant→tokens, principal→grant).
- `src/services/oauth`: approve writes exactly one audit row; reconnect reuses principal; code
  exchange + PKCE failure; refresh rotation + reuse-detection kill; device lifecycle
  (pending/slow_down/denied/expired); **SEC-8 negatives** (agent principal calling
  approveAuthorization/connectAgent → 403); disabled principal kills refresh.
- `connect-snippets` builders; `connectAgent` atomicity.

**Route-level (`app.request` pattern from `src/routes/api/api.test.ts` — full OAuth flow, no
browser)**: ① POST /mcp no auth → 401 + `WWW-Authenticate` header ② well-known docs (all
aliases) ③ DCR ④ login POST → cookie ⑤ GET /oauth/authorize → consent HTML ⑥ POST approve →
parse `code` from Location ⑦ POST /oauth/token + verifier → tokens ⑧ POST /mcp `tools/list` with
`rmo_` token → role-filtered tools ⑨ refresh → rotation, old access token dead ⑩ replay old
refresh → chain killed ⑪ device flow variant ⑫ revoke. Also: GET /mcp → 405; token-endpoint
errors are raw OAuth JSON; existing `src/mcp/mcp.test.ts` anonymous calls updated to send tokens.

**E2E (Playwright, `loginAsAdmin` helper)**: wizard happy path (name auto-fill + dirty guard,
mint, tab switching, clipboard with granted permissions), one-time invariant (reload → no token),
reconnect mode, index restructure assertions + "Never connected" health line; consent login
bounce (query string preserved), `<b>evil</b>` client name rendered as text, deny → callback
`error=access_denied` + state echo, approve → code + "via OAuth" badge on index, non-admin card,
invalid client_id → no external navigation. Axe sweep on new pages.

**Live interop (post-deploy, the real test)**: connect Claude Code to remill.org by URL alone
(OAuth walk), connect a claude.ai custom connector (paste URL), device-flow from an SSH box.
Watch for: metadata discovery variants, token-endpoint error shapes, loopback port-flex.

**Order of implementation** = Phases 1→6 (each independently type-checkable/testable). Riskiest:
the oauth services (Phase 2 — the invariant lives there) and real-client interop quirks
(mitigated by serving all metadata aliases; test with MCP Inspector before live clients).

## Revision Log

- 2026-07-23: **Implemented as planned**, with four deviations:
  1. `reconsentGrant` also deletes the grant's live access tokens (not just nulling refresh
     hashes) — a re-consent that narrows the role should not leave hour-long tokens named for the
     old grant lying around.
  2. Drizzle dropped `ON DELETE CASCADE` from the generated `api_tokens.grant_id` FK — hand-restored
     in migration 0014 (the cascade IS the revocation mechanism); CHECKs hand-added as planned.
  3. The wizard's client choice doubles as the persona: "Script / REST API" connections are created
     with subtype `service` (replaces the old Type select on the removed index form).
  4. The consent screen's ForbiddenError/InputValidationError paths re-render in place (native
     full renders, matching the zero-JS posture) rather than fragment morphs — the page is
     deliberately Datastar-free.
  5. **The consent POST answers with a 200 interstitial, not the planned 303** ("Returning you to
     {client}…" + meta refresh + Continue link). Found by e2e: the strict CSP's `form-action 'self'`
     makes Chrome block a form submission's redirect to the external callback, and no form-action
     source list can cover custom-scheme callbacks (`vscode://`). The interstitial is scheme-proof
     and keeps the strict CSP; GET-time param-error redirects stay 302s (not form submissions).
