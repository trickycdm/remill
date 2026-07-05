# remill — Review Remediation Plan (29 findings)

## Context

The end-to-end review (`plans/2026-07-04-cms-foundation/review.md`) surfaced **29 findings** across the brand-new, uncommitted `src/**` tree: 1 Critical, 9 High, ~10 Medium, ~9 Low. The core security thesis holds (single gated pipeline, anti-mass-assignment, default-deny, parameterized SQL), so nothing is a structural rewrite — the gaps are correctness bugs on common admin/REST paths, security hardening the platform lacks (rate limiting, headers, input bounds, committed default admin creds), and maintainability debt (field-type boilerplate, duplicated read-path authz, dead code, test holes, doc drift).

**Goal:** fix all 29 findings. **Outcome:** admin/REST/MCP paths behave correctly, the platform is deploy-safe, and the field engine + access layer are refactored to their own stated bar — with the build staying green (0 type errors, 0 lint, all tests, build OK) at every merge.

**Decisions locked (this session):** parallel git worktrees · full scope (incl. structural refactors) · remove `reference` from docs (don't implement) · **KV-backed** rate limiting.

---

## Strategy: 3 parallel worktrees + 1 sequential cleanup pass

Exploration confirmed the findings cluster into **three subsystems whose file sets are disjoint**, so they run concurrently in isolated worktrees with **zero merge conflicts**. A small set of genuinely cross-cutting cleanups (shared-helper dedup, test backfill, docs) is deferred to a **final Stream D** that runs after A/B/C merge.

| Stream | Subsystem | Runs | Findings |
|---|---|---|---|
| **A** | Data & Access Core | parallel (worktree) | COR-3, COR-5, COR-7ᵈ, COR-8, COR-9, TD-3, TD-9ᵈ, TD-11, SEC-7, TD-4ᵈ |
| **B** | Fields & Admin Forms | parallel (worktree) | COR-1, COR-2, COR-4, SEC-4ᶠ, TD-1, TD-2, TD-10, TD-13(accept) |
| **C** | Platform, Security & MCP | parallel (worktree) | C1, SEC-2, SEC-3, SEC-4ᵇ, SEC-5, SEC-6, SEC-8, COR-6, COR-7ᵐ, TD-9ᵐ, TD-4ᵐ |
| **D** | Cleanup · Dedup · Tests · Docs | **after A+B+C merge** | TD-5, TD-6, TD-7, TD-8, TD-12, TD-14 |

Superscripts mark split findings: ᵈ=documents side, ᵐ=media side, ᶠ=field-level, ᵇ=body-cap. Each half edits files owned by that stream only (see matrix at bottom).

### File-ownership map (disjointness guarantee)

- **A owns:** `src/services/documents/**`, `src/db/queries/{documents,principals,roles}.ts`, `src/db/schema.ts` + `src/db/migrations/**`, `src/access/**`, `src/lib/api-auth.ts`.
- **B owns:** `src/fields/**` (types, registry, all modules), `src/components/admin/{generated,collection-builder}.tsx`, `src/lib/admin-form.ts`, `src/routes/admin/c/**`, `src/routes/admin/settings/index.tsx`, + a new `src/fields/field-shell.tsx`.
- **C owns:** `src/main.tsx`, `src/lib/{api,media-serve}.ts`, `src/mcp/**`, `src/middleware/**` (+ new `rate-limit.ts`), `wrangler.jsonc`, `.dev.vars.tpl`, `src/db/seed.sql`, `package.json`, `src/services/{collections,access,media}/**`, `src/db/queries/media.ts`, `src/routes/api/collections/**`, `src/routes/admin/{login,media}/**`, `src/routes/media/**`.
- `src/config/constants.ts` is **imported** by A and C (page-size wiring) but **edited by neither** — the constants already exist, so no write conflict.

---

## Stream A — Data & Access Core

Order within stream: correctness first, then the index/unique migration, then the authz refactor.

1. **COR-3 — numeric/boolean filter+sort read the wrong column.** `db/queries/documents.ts`: `indexFilter` (L112) and the sort subquery (L132) hard-code `documentIndex.valueText`; number/boolean `toIndex` write `value_num`. Branch on the field's index type: compare/order `value_num` when the field is number/boolean, `value_text` otherwise. Thread the field's index kind from the service (`services/documents` `assertIndexed`/`loadCollection` already resolve the descriptor) into `ListFilter`/`ListSort`.
2. **COR-8 — race-prone `unique` with no DB backing.** Add a **partial `uniqueIndex`** on `document_index(collection, field_key, value_text)` (and a matching one for `value_num`) — scoped so it only applies to fields actually declared `unique` (SQLite NULLs are distinct; ensure non-unique indexed fields don't collide — use a filtered index or a dedicated `unique_key` column populated only for unique fields). Edit `db/schema.ts` (~L164-181), run `bun run db:generate` → `0003_*.sql`, then fix `checkUnique`/`isIndexValueTaken` to also cover numeric uniques (currently skips non-strings at `services/documents/index.ts:118` and reads only `valueText` at query L169).
3. **COR-5 — doc unsavable after a field is removed/retyped.** `services/documents/index.ts` `updateDocument` (~L270): strip undeclared keys from `existing.data` **before** the merge instead of letting `whitelistAndValidate` reject them. Reuse `whitelistOnly` semantics on the existing data.
4. **SEC-7 — `lastUsedAt` stamped before validity checks.** Reorder so `lib/api-auth.ts` (L41-42) checks expiry/disabled **before** `db/queries/principals.ts` (L113-124) writes `lastUsedAt`.
5. **TD-3 — resolve permissions once on the read path.** `access/authorize.ts`: `authorize()` (L53-54) and `compileReadFilter()` (L114/128) each resolve `getPrincipalPermissions` + `collectionPublicRead`. Compute `{permissions, publicRead}` once (in `listDocuments`, `services/documents/index.ts` L172/190) and thread into both. `permissions.ts::decide()` already takes pre-resolved inputs — no change there.
6. **TD-9ᵈ — drop re-fetch-with-`!`.** `services/documents/index.ts` L244/290/344: return the freshly written record from the query layer instead of a second `getDocument(...)!` round-trip.
7. **COR-7ᵈ — cursor pagination** for `listDocuments` (`db/queries/documents.ts` L139-140): replace `.offset()` with keyset (createdAt,id) cursor per DATABASE_STANDARDS.
8. **COR-9 / TD-11 — id-prefix + role-strength cleanup.** `db/queries/roles.ts`: mint `role_permissions` ids with `rlp_` and `principal_roles` with a distinct prefix (L59/67/87); derive `ROLE_STRENGTH` (L138) from `SYSTEM_ROLE_SLUGS` instead of a second hard-coded list.
9. **TD-4ᵈ** — import `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE` from `@/config/constants` in `services/documents/index.ts` (L174).

**Stream A tests (in-worktree):** numeric/boolean filter+sort now match/order; unique collision on create+update (incl. number field); update-after-field-removal succeeds; expired token doesn't stamp `lastUsedAt`; list read issues one permission resolution.

---

## Stream B — Fields & Admin Forms

Order: admin-form correctness first (independent of the refactor), then field bounds, then the FieldShell/contract refactor.

1. **COR-2 — blank optional fields abort the save.** `lib/admin-form.ts` `coerceAdminForm` (L40-42, the `default` case): drop empty strings for **non-required** fields (`'' → omit`), mirroring the existing `number` omit at L31. This is the root-cause fix for blank `select`/`media`/`json`/`datetime`.
2. **COR-1 — datetime unsavable (widget vs validator).** Coerce the `datetime-local` value (`YYYY-MM-DDTHH:MM`) to full ISO-with-`Z` in `coerceAdminForm` before it reaches `z.string().datetime()`; and on edit, format a stored ISO value back to the widget's local shape in `fields/datetime.tsx` (L15/34).
3. **COR-4 — multi-select loses values.** The three doc routes (`routes/admin/c/[collection]/new.tsx:44`, `[id]/index.tsx:110`, `settings/index.tsx:53`) call `parseBody()` without `{ all: true }`, so `<select multiple>` collapses to one string. Pass `{ all: true }`; then `coerceAdminForm`'s `select` array branch (L38) works. Fix the misleading comment at L37.
4. **SEC-4ᶠ — field-level input bounds.** Give string types a **default max length** (`fields/text.tsx` valueSchema), a size/depth cap on `fields/json.tsx` (replace bare `z.unknown()`), and a default `maxTags` on `fields/tags.tsx`. (Request-body byte cap is Stream C.)
5. **TD-2 — close the FieldType contract seams.** `fields/types.ts`: add `config` to `FieldCellProps` (L89-91) and the `CellComponent` signature (L121); update `components/admin/generated.tsx::FieldCell` (L26-33) to use `resolveField` (not `requireFieldType`) so cells get config — unblocks `select.tsx:80` rendering option *labels*. Additive/back-compat. (Leave `beforeRender`/explicit `jsonSchema` seams as-is; document them as intentionally-optional.)
6. **TD-1 — extract `FieldShell`.** New `fields/field-shell.tsx` wrapping the existing `FormField` (`components/ui/field.tsx`) — standardizes `label={field.label ?? field.key}`, `required`, placeholder/help sourcing (`field.admin?.placeholder`/`help`), and `id/name/value/data-bind` wiring. Refactor all 10 field modules onto it; add a shared `requiredNonEmpty(schema, field)` helper for the 3-way-divergent required rule. Fix the drifted hard-coded placeholder/help in `media.tsx`/`slug.tsx`.
7. **TD-10 — real select-options editor** in `components/admin/collection-builder.tsx` (replace the `{ value:'option' }` placeholder at L59) so admin-created `select` fields are usable.
8. **TD-13 — accept (won't-fix):** the `AnyFieldType = FieldType<never,never>` erasure seam is contained and defensible; leave as-is, note in code comment.

**Stream B tests (in-worktree):** datetime round-trips through admin save+edit; blank optional select/media/json omitted (save succeeds); multi-select persists an array; oversized text/json/tags rejected; a `select` cell renders the option label; FieldShell snapshot per type.

---

## Stream C — Platform, Security & MCP

Order: C1 immediately (P0), then security middleware, then gating/service hardening, then MCP layering + wiring.

1. **C1 (P0) — kill committed default admin creds.** `db/seed.sql` (L15-24) ships `admin@remill.local` / `remilladmin`; `package.json:28` `db:seed:remote` pushes it to prod. Replace with a bootstrap that generates a random password (or forces first-login reset); remove the known hash from the repo; make `db:seed:remote` refuse to write a default-credential admin. Update `.dev.vars.tpl` guidance.
2. **SEC-3 — security headers.** Add `hono/secure-headers` in `main.tsx` (L18-20) with a CSP compatible with Datastar (loaded in `layouts.tsx`); add `X-Content-Type-Options: nosniff` (+ `Content-Disposition: inline`) to `/media` responses in `lib/media-serve.ts` (L48-53).
3. **SEC-2 — KV-backed rate limiting.** Add a **KV namespace binding** to `wrangler.jsonc` (+ preview env); new `src/middleware/rate-limit.ts` (fixed-window counter keyed on `CF-Connecting-IP`/principal, cloning the `session.ts` factory shape); wire globally in `main.tsx` and apply tighter limits on login (`routes/admin/login`), token issuance (`services/access` `issueToken`), and uploads (`routes/admin/media/upload`, `routes/api/media`). Replace the stubbed `X-RateLimit-*` constants in `lib/api.ts` (L66-67) with real values; update `api.test.ts:72`.
4. **SEC-4ᵇ — request-body byte cap** in `lib/api.ts::jsonBody` (L23) and `routes/mcp.tsx` before parse.
5. **SEC-5 — schema-read exposure.** Keep collection discovery public (agent-native by design) **but** return a public-safe projection that omits internal `access`/`workflow` internals for unauthenticated callers, across `routes/api/collections/**`, `main.tsx` `/api/openapi.json` (L72-75), and `mcp/tools.ts` `list_collections` (L70-75); document the exception in SECURITY_STANDARDS (doc edit deferred to D).
6. **SEC-6 — validate collection `access`/`workflow`.** `services/collections/index.ts` `validateDefinition` (L77-85): Zod-validate `input.access`/`input.workflow` against a strict schema before persisting.
7. **SEC-8 — block agent self-escalation.** `services/access/index.ts` `assignRole`/`issueToken` (L89-100/179-199): refuse `manage_access`-related mutations when the acting principal is `kind:'agent'`.
8. **COR-6 — MCP layering + `get_media_url` authz.** `mcp/tools.ts`: drop the direct query imports (L15/20); add a `getMediaById` method to `services/media` that runs an `authorize()`/Grant check, and call it from the `get_media_url` handler (L172-180) instead of raw `getMedia`.
9. **COR-7ᵐ / TD-9ᵐ / TD-4ᵐ** — media list cursor pagination (`db/queries/media.ts` L75), drop re-fetch-`!` in `services/media/index.ts` (L74), and wire page-size constants + dedup `parseSort` inside `lib/api.ts` (L47-56) and `mcp/tools.ts` (L119-122) (both C-owned).

**Stream C tests (in-worktree):** seed no longer creates a known-credential admin; secure headers present on admin + `/media`; rate-limit returns 429 after threshold on login/upload; oversized body rejected; anonymous `list_collections`/openapi omit internal access flags; agent principal denied `assignRole`; `get_media_url` denies unauthorized media.

---

## Stream D — Cleanup · Dedup · Tests · Docs (sequential, after A+B+C merge)

Runs on a fresh worktree off the integrated `main`. Needs settled code (dedup spans files from A **and** C; tests must match final behavior).

1. **TD-5 — cross-stream dedup.** Extract `scopeMatches(scope, action, collection)` (dup in `access/permissions.ts:42`, `access/authorize.ts:117`, `mcp/tools.ts:42`) and a shared anonymous-principal factory (dup in `lib/api-auth.ts:16`, `lib/media-serve.ts:16`, inline in `authorize.ts` — note the drifting `surface` field). Reuse the existing `loadCollection` helper across the 6 route files that hand-repeat `getCollection→NotFoundError`.
2. **TD-6 — delete dead code.** Remove `lib/json-for-script.ts` (zero real callers). (`lib/logger.ts` is LIVE — keep.)
3. **TD-7 — UI dedup.** Collapse `Dialog`/`Drawer` onto a shared shell; add a `cx()` class-merge helper (inlined ~25×) and a `Checkbox` primitive (dup 3× in collection-builder); reuse `Spinner` in `Button`.
4. **TD-8 — test backfill (pre-existing holes).** Add the `media` field type to `registry.test.ts` (CASES is missing it; make the contract test iterate `listFieldTypeKeys()`); deepen the `jsonSchema` round-trip asserts (check `type`/`properties`/`required`); cover `json.beforeSave` throw, `document_index` removal on delete, and the session module (`lib/auth.ts`).
5. **TD-12 — convention gaps.** Add return types to exported JSX components; Zod-validate the `unknown`-boundary session reads (`lib/auth.ts:27,34`) instead of `as` casts.
6. **TD-14 — reconcile docs with code.** **Remove** the `reference` field example from `steering/SCHEMA_ENGINE.md` (L39/77) per decision; add **D18** to `docs/TECH_DECISIONS.md`; mark CodeMirror/Uppy islands as deferred in CLAUDE.md Tech Stack; fix the stale `src/mcp/agent.ts` reference (`mcp/tools.ts:10`); note the SEC-5 public-discovery exception in SECURITY_STANDARDS.

---

## Execution mechanics (worktrees)

1. Commit current `main` first (the whole build is uncommitted) so the streams branch from a clean base — **confirm with user before committing.**
2. Create 3 worktrees: `git worktree add ../remill-A remediation/data-access` (likewise B `fields-forms`, C `platform-security`), each off `main`.
3. Launch one subagent per worktree with its section above as the brief. Each keeps its worktree green (`bun run type-check && bun run lint && bun run test:run && bun run build`) and opens a PR.
4. Merge A, B, C in any order (files are disjoint); run full verify after **each** merge.
5. Create the D worktree off integrated `main`; run Stream D; final full verify + e2e (`bun run e2e`).
6. Log each stream's start/merge in `plans/2026-07-04-cms-foundation/worklog.md`; update `review.md` finding statuses as they close.

---

## Verification (end-to-end, not just tests)

- **Per-stream:** `bun run type-check` (0), `bun run lint` (0), `bun run test:run` (all green incl. new tests), `bun run build` (OK) in each worktree before merge.
- **After D / integration:** full `bun run e2e` (Playwright + axe) green; then drive the real app (`bun run dev`, 127.0.0.1:3100):
  - **COR-1/2/4:** create a collection with datetime + optional select + multi-select tags; save with blanks and with multiple selections → persists correctly, reloads into the form.
  - **COR-3:** REST `?filter[<number-field>]=N` and `?sort=<number-field>` return correct rows/order.
  - **COR-5:** remove a field from a collection, then re-save an existing doc → succeeds.
  - **C1/SEC-3:** fresh seed has no `remilladmin`; `curl -I` admin + `/media` shows CSP/nosniff/frame headers.
  - **SEC-2:** hammer `/admin/login` past the threshold → 429.
  - **COR-6/SEC-8:** an agent token is denied `get_media_url` on unauthorized media and denied `assignRole`.
- **Diff-behavior check:** confirm each fixed path was actually broken on `main` (reproduce, then verify fixed) — don't mark closed without proving it.

---

## Finding coverage matrix (all 29)

| ID | Sev | Stream | ID | Sev | Stream | ID | Sev | Stream |
|----|-----|--------|----|-----|--------|----|-----|--------|
| C1 | Crit | C | COR-4 | Med | B | SEC-8 | Med | C |
| COR-1 | High | B | COR-5 | Med | A | TD-4 | Med | A+C |
| COR-2 | High | B | COR-6 | Med | C | TD-5 | Med | D |
| COR-3 | High | A | SEC-5 | Med | C | TD-6 | Med | D |
| SEC-2 | High | C | SEC-6 | Med | C | TD-7 | Med | D |
| SEC-3 | High | C | SEC-7 | Med | A | TD-8 | Med | D |
| SEC-4 | High | B+C | COR-7 | Low | A+C | TD-11 | Low | A |
| TD-1 | High | B | COR-8 | Low | A | TD-12 | Low | D |
| TD-2 | High | B | COR-9 | Low | A | TD-13 | Low | B(accept) |
| TD-3 | High | A | TD-9 | Low | A+C | TD-14 | Low | D |
| | | | TD-10 | Low | B | | | |

All 29 mapped. TD-13 explicitly accepted (no change). `reference` field: docs-only removal in TD-14.
