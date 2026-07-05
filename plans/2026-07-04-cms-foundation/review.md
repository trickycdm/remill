# End-to-End Code Review — remill

**Date:** 2026-07-05 · **Scope:** entire `src/**` tree (~9,800 LOC, ~130 files), all uncommitted/brand-new · **Reviewers:** 3 parallel agents — correctness (`code-reviewer`), security (`security-reviewer`), tech-debt (`tech-debt-reviewer`).

---

## Executive summary

remill delivers on its central thesis. **All three write paths (admin SSR, REST, MCP) genuinely funnel through one `authorize()`-gated, whitelist-validated pipeline** in `src/services/documents/index.ts`; anti-mass-assignment is enforced three ways (unknown-key loop, `whitelistOnly`, Zod `.strict()`); the `Grant` witness type makes "forgot to authorize" a *compile* error; `decide()` is default-deny + additive-only; SQL is fully parameterized (the field key is a bound value, not an interpolated identifier — the exact Blogmill hole is structurally closed); passwords use scrypt + per-password salt + constant-time compare; tokens are per-principal, SHA-256-hashed at rest. Layering (Routes → Services → Queries → D1) holds everywhere except one MCP module; there is **no `any`, no `@ts-ignore`, no unsafe cast** in production code beyond a small contained type-erasure seam.

**The gaps are at the edges, not the core.** One operational security risk stands out (committed default admin credentials that the remote-seed script pushes to production). Three correctness bugs break common admin/REST paths (datetime saves, blank-optional-field saves, numeric/boolean filter+sort). The rest are hardening gaps (no rate limiting, no security headers, no input bounds) and maintainability debt (field-type boilerplate, duplicated read-path authz, dead utilities, doc/code drift).

**Verdict: no merge-blocking data-loss or auth-bypass criticals — but fix C1 and the three High correctness bugs before this is used for real, and the security hardening items before any production deploy.**

### Findings by severity

| Severity | Count | Items |
|----------|-------|-------|
| **Critical** | 1 | C1 |
| **High** | 9 | COR-1, COR-2, COR-3, SEC-2, SEC-3, SEC-4, TD-1, TD-2, TD-3 |
| **Medium** | 10 | COR-4, COR-5, COR-6, SEC-5, SEC-6, SEC-7, SEC-8, TD-4, TD-5, TD-6, TD-7, TD-8 |
| **Low** | 9 | COR-7, COR-8, COR-9, TD-9, TD-10, TD-11, TD-12, TD-13, TD-14 |

Lens tags: **[C]** correctness · **[S]** security · **[T]** tech-debt.

---

## 🔴 Critical

### C1 [S] — Committed default admin credentials shipped to production by the remote seed
`src/db/seed.sql:15-24` · `package.json:28` (`db:seed:remote`)
The seed inserts `admin@remill.local` with a hash that recomputes to the plaintext **`remilladmin`** (verified). The hash + salt are in the repo, and `bun run db:seed:remote` writes this row to production D1. Any freshly-seeded prod instance ships with publicly-known full-admin credentials and no forced rotation. *Severity is Critical **if** `db:seed:remote` is ever run against prod; High otherwise.* **Fix:** generate a random password at bootstrap or force a first-login reset; never ship a known hash to production.

---

## 🟠 High

### COR-1 [C] — `datetime` fields are unsavable from the admin (widget vs validator mismatch)
`src/fields/datetime.tsx:15,34` · `src/lib/admin-form.ts:40-43`
The edit widget is `<Input type="datetime-local">`, which emits `YYYY-MM-DDTHH:MM` (no seconds/TZ). `coerceAdminForm` passes it through unchanged, but `valueSchema` is `z.string().datetime()` (requires full ISO + `Z`). Every datetime save from the admin throws `InputValidationError`; any collection with a datetime field is unsavable via admin. **Fix:** coerce the local value to ISO in `coerceAdminForm`, or validate with a widget-compatible schema.

### COR-2 [C] — Blank optional `select`/`media`/`json`/`datetime` fields abort the whole save
`src/lib/admin-form.ts:40-43` (root cause) · `select.tsx:33` · `media.tsx:20-22` · `json.tsx:26-35`
For blank fields `coerceAdminForm` writes `out[key] = ''` (only `number` is correctly omitted). `''` is a *present* value, so `.optional()` doesn't skip it: optional single-`select` rejects `''`, `media` rejects `''`, and `json.beforeSave` runs `JSON.parse('')` → throws. Leaving any optional select/media/json/datetime blank fails the entire document save. **Fix:** drop empty strings for non-required fields (`'' → absent`) in `coerceAdminForm`.

### COR-3 [C] — Filtering/sorting on numeric or boolean indexed fields silently returns wrong results
`src/db/queries/documents.ts:111-113` (filter) · `:131-133` (sort)
`indexFilter` and the sort subquery only ever read `document_index.value_text`, but `number.toIndex`/`boolean.toIndex` write to `value_num` (with `value_text` null). So `?filter[price]=42` matches zero rows and `?sort=price` orders by an all-null column. `assertIndexed` lets these through, so callers get a silent 200 with empty/mis-ordered data. The unused `document_index_num_idx` confirms this was intended but never wired. **Fix:** branch on the field's index type and compare/order `value_num` for number/boolean.

### SEC-2 [S] — No rate limiting anywhere (login, token issuance, upload)
`src/lib/api.ts:63-69` (headers stubbed) · `routes/admin/login/index.tsx:66` · `services/access/index.ts:179` · media upload routes
`SECURITY_STANDARDS.md §8` mandates rate-limiting keyed on `CF-Connecting-IP`/principal; only fake `X-RateLimit-*` headers exist. Login is brute-forceable/credential-stuffable (scrypt slows but there's no lockout); uploads are a DoS vector. **Fix:** real rate limiting via a CF binding or DO/KV counter.

### SEC-3 [S] — Security response headers entirely absent
`src/main.tsx:18-20` · `src/lib/media-serve.ts:48-53`
No CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options: nosniff`, or `Referrer-Policy` on any response, despite `SECURITY_STANDARDS.md §8` requiring all of them. Impact: clickjacking, weakened XSS defense-in-depth (app leans entirely on JSX escaping), and user media served with no `nosniff` from the admin origin. **Fix:** add `hono/secure-headers` + the specified CSP globally; add `nosniff` (+ `Content-Disposition`) on `/media`.

### SEC-4 [S] — Unbounded field values → DoS / storage abuse
`src/fields/text.tsx:22-28` (maxLength optional) · `json.tsx:16-19` (`z.unknown()`, no cap) · `tags.tsx:20-29` (maxTags optional); no body-size cap in `lib/api.ts:20-31` or `routes/mcp.tsx`
A field created without an explicit bound accepts arbitrarily large input; `json` accepts arbitrarily large/deep JSON stored verbatim. Any principal with `create` can push huge payloads through the whitelist (which validates keys, not size). **Fix:** default max length on strings, size/depth cap on `json`, request-body byte cap on REST/MCP.

### TD-1 [T] — The FieldType `EditComponent` (core extension point) is copy-paste boilerplate that has silently diverged
`src/fields/{text,slug,markdown,number,boolean,datetime,select,tags,json,media}.tsx`
All 10 modules open with an identical `<FormField…>` + `<Input value={value ?? ''} data-bind={signal}>` block (each idiom appears 10×), with no `<FieldShell>` seam — and the copies have drifted: `media.tsx:35` hard-codes its description (ignores `field.admin?.help`), `slug.tsx:68`/`media.tsx:41` hard-code placeholders, and the `required ⇒ non-empty` rule is re-derived three different ways. SCHEMA_ENGINE promises "add a module, no other changes," but type #11 means cloning ~15 lines and re-choosing each convention. **Fix:** extract `FieldShell`/`renderEdit` + a shared `requiredNonEmpty(schema, field)`.

### TD-2 [T] — The FieldType contract has leaky/missing seams that will force a breaking interface change
`src/fields/types.ts:89-91,115,116,125`
`FieldCellProps` carries only `value` (no `config`), so `select.tsx:80` physically cannot render an option's label in a list cell — every future config-dependent cell hits this wall. `beforeSave`'s typed `Value` is a lie at the form boundary (widget posts a raw string → defensive re-parsing in `tags.tsx:45`, `json.tsx:27`). Advertised-but-unused seams: `beforeRender` (0/10 types), explicit `jsonSchema` override (0/10). **Fix:** thread `config` into cell props, add a distinct wire/input type vs stored `Value`.

### TD-3 [T] — `authorize()` and `compileReadFilter()` independently recompute permissions on every list request
`src/services/documents/index.ts:172-190` · `access/authorize.ts:53-58,114-137`
On the hot read path, `authorize()` resolves `getPrincipalPermissions` + `collectionPublicRead`, then `compileReadFilter` resolves them **again** plus role slugs + granted-doc-ids; `getCollection` runs up to 3×. Beyond wasted round-trips, "what can this principal read" is now encoded in two functions that must stay in agreement — drift risk in exactly the code where drift is a security bug. **Fix:** resolve permissions once, thread the result into both the decision and the filter compilation.

---

## 🟡 Medium

### COR-4 [C] — Multi-select admin saves lose all-but-one value, then fail validation
`routes/admin/c/[collection]/new.tsx:44` · `[id]/index.tsx:110` · `settings/index.tsx:53` · `lib/admin-form.ts:36-38`
Routes call `c.req.parseBody()` without `{ all: true }`, so `<select multiple>` collapses to the last value (a string). `coerceAdminForm` only builds an array when `Array.isArray(raw)` (never true here), so a `multiple` select's `z.array()` schema receives a string and rejects it. The inline comment claiming "multi-select posts repeated keys → array" is wrong for Hono's default `parseBody`. **Fix:** parse with `{ all: true }`.

### COR-5 [C] — A document carrying data from a removed/retyped field can never be saved again
`src/services/documents/index.ts:270-271,50-59`
On update, `merged = { ...existing.data, ...whitelistOnly(...) }` is validated by `whitelistAndValidate`, which rejects any key not currently declared. Per SCHEMA_ENGINE/DATABASE_STANDARDS, stale values should persist and drop on next save — but here the next save throws `InputValidationError` for the stale key, so the doc (and its revision restore) is permanently unsavable after a schema edit. **Fix:** strip undeclared keys from `existing.data` before/inside the merge instead of rejecting.

### COR-6 [C/S] — MCP tool module reaches directly into the query layer and skips `authorize()`
`src/mcp/tools.ts:15,20,176-178`
The invariant is MCP surface → Services → Queries. `tools.ts` imports and calls `getMedia` and `getPrincipalPermissions` from the query layer directly; `get_media_url` reads media metadata via `getMedia(db,…)` with no `authorize()` gate (only a coarse `couldDo` visibility check), returning `url/mime/alt` outside the service pipeline. Layering violation + defense-in-depth authz gap. **Fix:** route media/permission reads through the media/access services.

### SEC-5 [S] — Full content schema readable by anonymous on every surface (default-deny deviation)
`routes/api/collections/index.tsx:12-14` · `[slug].tsx:14-18` · `main.tsx:72-75` (openapi.json) · `mcp/tools.ts:70-75`
`listCollections`/`getCollection` run with no principal and no `authorize()`, so an unauthenticated caller can enumerate every collection slug, field type/config, workflow, and `access` flags. Likely intentional for discoverability but contradicts the stated default-deny posture and leaks the internal content model. **Fix:** document as an explicit exception, or gate behind `read`/`manage_schema`.

### SEC-6 [S] — Collection `access`/`workflow` config stored unvalidated
`src/services/collections/index.ts:77-85`
`validateDefinition` carefully normalizes fields but passes `input.access`/`input.workflow` through with no schema check. Only `access.publicRead` is honored today (so not currently exploitable), but arbitrary attacker-shaped JSON from a `manage_schema` principal is persisted into a security-relevant column. **Fix:** Zod-validate against a strict schema.

### SEC-7 [S] — `lastUsedAt` written before token validity checks
`src/db/queries/principals.ts:113-124` → `src/lib/api-auth.ts:41-42`
An expired token, or a token for a disabled principal, still triggers a DB write on each attempt (write-amplification + a weak oracle that the hash exists). Not exploitable for access. **Fix:** check expiry/active before stamping `lastUsedAt`.

### SEC-8 [S] — No structural block on an agent with `manage_access` escalating
`src/services/access/index.ts:89-100,179-199`
`ACCESS_CONTROL.md` says granting an agent `manage_access` requires a human decision and agents must not escalate. Default roles never grant it (requires human misconfig first), but once an agent has it, nothing stops it assigning admin roles or minting tokens for other principals. **Fix:** refuse `manage_access` mutations when the acting principal is `kind: 'agent'`.

### TD-4 [T] — `constants.ts` is under-wired; the repo violates its own "no inlined magic number twice" rule
`src/config/constants.ts:10-11,14`
`DEFAULT_PAGE_SIZE` (25) and `MAX_PAGE_SIZE` (100) are never imported — the literals are inlined at `documents/index.ts:174`, `lib/api.ts:56`, `mcp/tools.ts:120`, and `media/index.ts:94` uses a *different* pair (24/60) for the same concept. `THEME_STORAGE_KEY` is never imported (`'remill-theme'` hard-coded 2× in `admin-shell.tsx`). **Fix:** import the constants everywhere.

### TD-5 [T] — Cross-surface logic re-implemented rather than shared
Multiple files
Token-scope match predicate duplicated in `permissions.ts:42`, `authorize.ts:117`, `mcp/tools.ts:42`. Sort `-`-prefix parsing duplicated in `lib/api.ts:49` and `mcp/tools.ts:122`. `getCollection → throw NotFoundError` hand-repeated in 6 route files despite an existing `loadCollection` helper. The anonymous principal is materialized 3× with a **drifting `surface`** field (`api-auth.ts:16` `'rest'`, `media-serve.ts:16` `'admin'`, inline in `authorize.ts`). **Fix:** extract the three predicates + a shared anon-principal factory.

### TD-6 [T] — Dead / over-built utilities in `src/lib`
`json-for-script.ts` (entirely dead — referenced only by a comment), `logger.ts` (51 lines backing exactly one live `log.warn` call; `withRequestContext`/info/error/debug/child all unused), `requireRole` middleware (`lib/auth.ts:74`, exported, used by zero routes). **Fix:** delete the dead code (fast pure win).

### TD-7 [T] — UI component library duplicates itself; no class-merge or checkbox primitive
`components/ui/*`
`Dialog` and `Drawer` are ~90% identical (`dialog.tsx:41-78` vs `drawer.tsx:31-71`). `Button` re-hand-rolls the spinner path that already exists as `Spinner` in `icon.tsx`. The `${cls ? …}` merge idiom is inlined ~25× with no `cx()` helper; focus-ring string inlined 15+×. No `Checkbox` primitive → the checkbox class string is duplicated 3× in `collection-builder.tsx`. **Fix:** add `cx()` + `Checkbox`, collapse Dialog/Drawer onto a shared shell.

### TD-8 [T] — Core-engine test coverage has specific load-bearing holes
`fields/registry.test.ts` and service tests
The **`media` field type is entirely absent** from `registry.test.ts` (CASES has 9 of 10; the contract test iterates CASES not `listFieldTypeKeys()`). The `jsonSchema` half of the round-trip (the headline feature) asserts only `toBeTruthy()` — never checks `type`/`properties`/`required`. `json.beforeSave` throw untested; whitelist rejection tested only on create (not update); `document_index` removal on delete untested; the entire session module (`lib/auth.ts`) has zero coverage. **Fix:** close these specific gaps.

---

## 🟢 Low

### COR-7 [C] — `OFFSET` pagination contradicts the mandated cursor pagination
`src/db/queries/documents.ts:140` · `media.ts:75` — DATABASE_STANDARDS §"Query performance" requires cursor pagination; both list queries use `.offset()`. Convention violation + scaling cost.

### COR-8 [C] — `unique` field enforcement is racy with no DB constraint
`src/services/documents/index.ts:109-123` · `schema.ts:176-180` — relies solely on a `SELECT` before insert; `document_index` has only non-unique indexes. Two concurrent creates with the same slug can both pass. Low likelihood on single-tenant, but no DB-level guard. **Fix:** add a UNIQUE constraint.

### COR-9 [C] — ID prefixes misassigned for two join tables
`src/db/queries/roles.ts:59,67,87` — `role_permissions` ids minted with `newId('role')` → `rol_` (should be `rlp_`); `principal_roles` ids minted with `newId('principal')` → `prn_`, colliding with real principal ids. Cosmetic but defeats the prefix convention.

### TD-9 [T] — Re-fetch-after-write with non-null assertion
`services/documents/index.ts:244,290,344` · `media/index.ts:74` — each write ends `return (await dq.getDocument(…))!`, an extra round-trip + a `!` where the freshly written record could be returned directly.

### TD-10 [T] — Admin-created `select` fields are placeholders
`components/admin/collection-builder.tsx:59` — the builder has no options editor, so it seeds a dummy `{ value: 'option' }`; a select created via admin UI is meaningless until re-authored via REST/MCP.

### TD-11 [T] — Small inconsistencies
Batch-tuple cast is a clean `type Batch` alias in `documents.ts:178` but verbose inline in `roles.ts:61,73`; `ROLE_STRENGTH` (`roles.ts:138`) hard-codes the system-role list independently of `SYSTEM_ROLE_SLUGS` (`policy.ts:74`).

### TD-12 [T] — Convention gaps
Exported JSX components omit return types (CODING_CONVENTIONS requires them on exported functions); session reads use unchecked `as string | null` casts (`lib/auth.ts:27,34`) at an `unknown` boundary the conventions say to Zod-validate.

### TD-13 [T] — Type-erasure seam
`AnyFieldType = FieldType<never, never>` (`types.ts:129`) forces `as never` at every registry call site. Contained and defensible, but the one spot the strict engine loses type safety on its own values.

### TD-14 [T] — Steering ↔ code drift (docs overstate completeness)
The **`reference` field type is in the SCHEMA_ENGINE "constitution" example but unimplemented** (its example collection would be *rejected* by `validateDefinition`); CLAUDE.md advertises "CodeMirror 6 island" + "Uppy uploads" but `client/init.ts` is an empty stub and `markdown.tsx`/`tags.tsx`/`media.tsx` are plain inputs; `mcp/tools.ts:10` references a non-existent `src/mcp/agent.ts`; CLAUDE.md cites "D18" but `docs/TECH_DECISIONS.md` stops at D17. **Fix:** reconcile docs with code (add D18, mark islands as deferred, remove/implement `reference`).

---

## Recommended sequencing

1. **Before real use:** C1 (rotate/randomize admin creds) + COR-1, COR-2, COR-3 (common-path admin/REST bugs) + COR-4, COR-5.
2. **Before any production deploy:** SEC-2, SEC-3, SEC-4 (rate limiting, security headers, input bounds); revisit SEC-5.
3. **Structural, do once before more traffic/field types:** TD-1 + TD-2 together (field contract refactor — unlocks the `select`-label and `reference` gaps), then TD-3 (single permission resolution on the read path).
4. **Fast wins:** TD-6 (delete dead code), TD-4 (wire constants), TD-14 (reconcile docs).
5. **Schedule:** remaining Medium/Low.

## Areas verified clean

Access decision core (`decide`/`authorize`/`compileReadFilter` logic, token-scope narrowing, in-SQL read filter); atomic save batch (delete-then-insert index sync + revision append in one `db.batch()`); password/token crypto (scrypt salt, constant-time compare, enumeration-timing mitigation, SHA-256 token hashing); row↔domain mapping + safe JSON parsing (no Drizzle types leak upward); SQL parameterization (field key bound as value, not interpolated); MIME signature allowlist (excludes SVG/HTML); JSX auto-escaping; the layering invariant (only `src/db/queries/**` imports Drizzle, only test files touch D1 directly — except the one MCP exception in COR-6).
