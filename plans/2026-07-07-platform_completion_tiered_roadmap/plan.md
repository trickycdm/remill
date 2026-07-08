# Platform Completion Roadmap — Tiers 1–3

**Status: PARTIAL — 2026-07-08 (Tiers 1–2 / Phases 1–8 of 11 DONE, verified; Tier 3 not started)**

> **STATUS: TIERS 1–2 COMPLETE (Phases 1–8, 2026-07-08) — Tier 3 (Phases 9–11) not started.**
> All eight phases live on `feature/platform-completion-tier1` (per-phase commits from ac35d4b
> on; Tier 1 = 7f8815d), verified at Tier-2 close: 323 unit / 53 e2e / lint / build / migrations
> 0007–0011 applied locally. See worklog.md for the step record incl. the RE-PLANs (Tier 1: FTS
> prepared-statement batching, audit_log `collection` column; Tier 2: drain-in-service, system
> revisions saved_by NULL, discovery service module, import publish-gate). 11 phases, each
> independently shippable. This plan is written to be executed by a fresh session with no
> conversation context — every design decision is already made and recorded here. Do not
> re-litigate decisions; if an assumption proves wrong, follow the Re-planning Rules (log
> `RE-PLAN` in worklog.md, edit this file in place, add a Revision Log entry).

## Context

remill is complete through its founding roadmap: the CMS foundation (phases 0–7), Track A (access
legibility), Track B (relations/graph/lifecycle), Track C (public pages/share links), and sharing
fabric v2 (teams, agent share links, Resend, raw HTML pages). A capability audit (2026-07-07) found
that the *architecture outruns the product* in three ways:

1. **The agent-parity promise has holes.** The project brief's success criterion is "an agent over
   MCP can do everything a non-technical admin can" — but agents cannot delete documents, upload
   media, or work with revisions. Delete is also unsafe to hand to agents today (hard delete, FK
   cascades destroy revisions/grants).
2. **Querying is the weakest layer relative to the pitch.** Filters are exact-match equality only;
   no ranges, no contains, no full-text search. For an agent-native platform, *finding things* is
   the thinnest capability.
3. **Several built systems are write-only or stubbed.** The audit log is written on every request
   but has no read surface; the dashboard activity card is a placeholder; the markdown/media field
   widgets are plain inputs (D12/D13 never implemented); public pages have no feeds/sitemap/OG meta.

This plan closes those gaps with 10 features in 11 phases. It was scoped interactively; four design
forks were put to the user and decided (see **Decisions already made**). Tier-4 ideas that were
considered and deliberately excluded are listed at the bottom — do not implement them.

**Feature → phase map:**

| Tier | Feature | Phase(s) |
|---|---|---|
| 1 | Query power: filter operators + FTS5 search | 1 — DONE |
| 1 | MCP parity: trash + delete/upload/revisions tools | 2, 3 — DONE |
| 1 | Audit surfacing + token last-used | 4 — DONE |
| 2 | Scheduled publishing | 5 — DONE |
| 2 | Public discovery: feeds/sitemap/OG/`/` index | 6 — DONE |
| 2 | Events outbox (poll-based change feed) | 7 — DONE |
| 2 | Import/export + R2 snapshot | 8 — DONE |
| 3 | Editor islands: CodeMirror + media picker | 9 |
| 3 | Revision diff viewer | 10 |
| 3 | Bulk actions on admin lists | 11 |

**Phase dependencies:** 2 → 3 (delete tool needs trash), 2 → 5 (cron infra), 2 → 11 (bulk-trash),
7 → 8 (import auto-emits events). Phase 1 goes first so every later write path maintains the FTS
index from day one. Phases 4, 6, 9, 10 are independently schedulable.

## How to execute (fresh-session bootstrap)

- **Read first:** root `CLAUDE.md`, then the steering doc(s) named in each phase before touching
  that area. Steering is authoritative; when code disagrees with steering, flag it.
- **Commands:** `bun run dev` / `bun run build` / `bun run type-check` / `bun run lint` /
  `bun run test:run` (vitest) / `bun run e2e` (Playwright vs built preview on 127.0.0.1:3100,
  serial single worker) / `bun run db:generate` (drizzle-kit) / `bun run db:migrate` (local apply).
- **Routes are generated:** add files under `src/routes/`, run `bun run routes` to regenerate
  `src/router.ts`. Never hand-register routes in `src/main.tsx` except the documented dotted-path
  exceptions (`/api/openapi.json` precedent at `src/main.tsx:83`; this plan adds `/rss.xml`,
  `/sitemap.xml`, `/robots.txt`).
- **Layering invariant:** routes/jobs → services (all business logic + ALL `authorize()` calls) →
  queries (`src/db/queries/` is the ONLY Drizzle importer) → D1. Query mutation functions demand a
  `Grant` witness parameter that only `src/access/` can mint.
- **Migrations:** drizzle-kit generates numbered `.sql` into `src/db/migrations/` (journal in
  `meta/_journal.json`); files are plain SQL and hand-editable — CHECK constraints and raw
  statements are hand-added by precedent (see 0000, 0004, 0006). `bunx drizzle-kit generate
  --custom` produces an empty migration for hand-written SQL. Never edit an applied migration.
- **E2E conventions:** specs import `{ test, expect }` from the e2e fixtures module (never
  `@playwright/test`); fixtures `page` (admin), `authorPage` (least-priv), `anonymousPage`; each
  spec file sets a distinct `CF-Connecting-IP`; locator priority getByRole > getByLabel > getByText
  > getByTestId; `FormField` appends " (required)" to accessible names — use anchored regex.
  **Every new admin page must be added to the axe sweep spec (zero-violations invariant).**
- **Worklog:** append a row to this plan folder's `worklog.md` after each meaningful step
  (`| YYYY-MM-DD HH:MM | action | detail |`). When done with everything, run `/wrap-up`.
- Line numbers cited below were verified 2026-07-07; treat them as anchors, not gospel — re-locate
  by symbol name if drifted.

## Decisions already made (do not re-open)

1. **Trash model = separate `document_trash` table** (not `deleted_at` in place). On delete,
   snapshot doc + recent revisions into trash, then hard-delete the original so FK cascades clear
   index/grants. Zero read-path changes ⇒ no leak risk; uniqueness checks unaffected. User-chosen.
2. **Media picker = lightweight native island, superseding D12 (Uppy).** Dialog-based browser +
   native file input against the existing upload service. User-chosen; log the supersession.
3. **Admin search = header search box + `/admin/search` results page** with `/`-or-cmd-K focusing
   it. No command-palette overlay. User-chosen.
4. **Events outbox access = per-collection read filtering** (callers see events only for
   collections they can `read`), not admin-only. User-chosen.
5. **CodeMirror 6 for markdown** — implements the already-logged D13; not a new decision.
6. No new ACTIONS are introduced anywhere in this plan (audit read reuses `manage_access`; export
   reuses `read`; import reuses `create`/`update`). The only closed-vocabulary change is adding
   `'system'` to `Surface` and `Principal.kind` (Phase 5, decision D30).

## Verified codebase facts (cross-cutting)

- **Atomic write batch** (`src/db/queries/documents.ts:333-431`): `insertDocument`/`updateDocument`
  build `BatchItem<'sqlite'>[]` arrays → `db.batch()`. Update = doc UPDATE + DELETE all index rows +
  re-insert (`indexInserts` :335) + append revision. Drizzle `BatchItem` accepts `db.run(sql\`…\`)`
  raw statements — verified — so FTS writes and event inserts extend these arrays.
  `deleteDocument` (:434-440) is a single hard DELETE; index/revisions/item_grants FK-cascade.
- **document_index** (`src/db/schema.ts:171-199`): `valueText` TEXT + `valueNum` REAL;
  `uniqueKey = "${collection}:${fieldKey}"` with two UNIQUE indexes. Field routing:
  `NUMERIC_INDEX_TYPES = {number, boolean}` → value_num, everything else → value_text
  (`src/services/documents/index.ts:112-115`); datetime is ISO text (lexical range compare is
  correct). `buildIndex` at `services/documents/index.ts:129-150`; `toIndex` on FieldType returns
  scalar/array; markdown/html store only a 200-char plaintext lead-in.
- **Filter compilation** (`src/db/queries/documents.ts:187-190, 210-215`): each filter →
  `documents.id IN (SELECT document_id FROM document_index WHERE collection=? AND field_key=? AND
  value_*=?)`, AND-combined; sort via correlated subquery (:222-224); keyset cursor only on default
  sort (:216-227); access filter from `compileReadFilter` (`src/access/authorize.ts:145-183`)
  AND-ed into `baseWhere`, shared with COUNT (D17: never post-filter in memory).
  Param parsing: `listQuery` in `src/lib/api.ts:60-82` (`filter[field]` regex); service-side
  `assertIndexed` 400s unindexed fields (`services/documents/index.ts:468-474`).
- **MCP** (`src/mcp/tools.ts`): `buildToolsForPrincipal` re-derived per request (handler.ts:63,72);
  `couldDo(perms, principal, action, collection, publicRead)` (:38-49) intersects role permissions
  with `tokenScope` via `scopeMatches` (`src/access/permissions.ts:48-50`); per-collection loop
  :116-252 (skips `media`); `docInputSchema` (:51-59) uses `jsonSchemaFor` (same generator as
  OpenAPI). Canonical new-tool template: `share_link_<slug>` block (:221-251).
  `SHARE_LINK_MAX_TTL_MS` 30d clamp (:63). Unknown tool == forbidden tool (handler.ts:76-80).
  Tool naming `<verb>_<slug>`, slug `^[a-z][a-z0-9_]*$`. MCP body cap: `assertBodyWithinLimit` at
  `src/routes/mcp.tsx:21` → `MAX_JSON_BODY_BYTES = 1 MiB` (`src/lib/api.ts:23`).
- **Access:** `ACTIONS` closed set (`src/access/types.ts:11-21`); `Surface = 'admin'|'rest'|'mcp'`
  (:27); `Principal.kind = 'user'|'agent'` (:34). `authorize(db, principal, action, resource, now,
  preResolved?)` → `Grant` (`src/access/authorize.ts:82-137`) writes exactly ONE `appendAudit` row
  allow-or-deny (:120-128) — the only audit writer. `resourceKey` = `document:<id>` |
  `collection:<slug>` (`types.ts:58-60`). Grant = nominal class, private ctor, `static __mint` not
  re-exported (`src/access/grant.ts:35-37`); test escape `grantForTest()` in `src/test/`.
  Agents blocked from access-management mutations via `refuseAgentEscalation` (carve-out:
  `share_link`). Duplicating the action list: `src/access/policy.ts:25-34` + `src/db/seed.sql`,
  drift-guarded by `src/db/seed.test.ts`.
- **Documents service** (`src/services/documents/index.ts`): `deleteDocument` :799-811 (authorize
  read → load → authorize delete → hard delete); `restoreRevision` :814-827 delegates to
  `updateDocument`; `setPublished` :755-797 (requires `hasLifecycle`); update appends a revision via
  `nextRevisionNumber` in the same batch; opaque cursor = base64 `createdAt|id` (:476-489).
- **Media:** `uploadMedia` (`src/services/media/index.ts:31-78`): authorize `create` on `media`,
  `MAX_UPLOAD_BYTES` 25 MiB, `sniffMime` from bytes (never client claim), alt required for images,
  R2 `MEDIA` binding. REST route `src/routes/api/media.tsx:13-27` with `rateLimit('upload',
  30/60s)`. No base64→bytes decode path exists yet. `nodejs_compat` is on (Buffer available).
- **Admin UI:** page pattern = `factory.createHandlers(requireAuth() [, requireRole('admin')],
  handler)` + `c.render(<AdminShell user current="key">…)`; nav = `NAV_ITEMS` + `NAV_BY_ROLE` +
  `visibleNav` (`src/components/layouts/admin-shell.tsx:54-78`). Access pages use classic native
  `method="post"` forms with hidden `op` dispatch (`routes/admin/access/teams/index.tsx:220-291` is
  the template); editor forms use whole-form Datastar `@post` (`components/admin/generated.tsx:
  54-97`). `dsRedirect`/`dsError` in `src/lib/datastar-response.ts`; Datastar patches only from
  2xx, never 3xx. `GeneratedTable` (generated.tsx:101-166) has no selection mechanism.
  `EditorSidebar` (`components/admin/editor-sidebar.tsx`): primary Save (external submit via
  `form=` attr), Publish native POST if `def.workflow?.draftPublish`, revisions `<ol>` with
  per-revision restore POST (:137-144), Delete Dialog.
- **Islands:** `src/client/init.ts` is an `export {}` stub loaded globally from
  `src/layouts.tsx:31`. vite-ssr-components discovers `<Script>` ONLY in `src/layouts.tsx` +
  `src/routes/**` — island Scripts go in ROUTE files, not shared components
  (steering/DATASTAR_PATTERNS.md §"Script loading"). Island↔form handoff (§g): keep the
  `data-bind`'d control in the DOM; island writes `.value` + dispatches bubbling `input` event.
  CodeMirror/Uppy are NOT in package.json.
- **Public surface:** `routes/[collection]/[slug]/index.tsx` uses `anonymousPrincipal('rest')`
  through the same authorize/compileReadFilter; single indistinguishable 404; `rawPageHtml`
  short-circuit for `renderMode:'raw'`. Public route accepts a `doc_…` id in place of a slug
  (verified). HEAD is built once in `src/layouts.tsx` `RootLayout` (jsxRenderer, no props today) —
  no per-page title/OG mechanism exists. `/` = `c.redirect('/admin')` (`src/routes/index.tsx`).
  CSP fork: `src/middleware/security-headers.ts`, `PROTECTED_PREFIXES = ['/admin','/api','/mcp',
  '/auth','/media']`; new top-level public routes inherit the PUBLIC policy automatically (caveat
  documented at :19-22).
- **Settings** = a `settings` singleton *collection document* (not a table), read witness-free via
  `getSingletonData` (`queries/documents.ts:88-100`); `SiteSettings` + defaults in
  `src/services/settings/index.ts:22-63` (`allowCdnScripts` boolean is the add-a-setting template;
  new settings need NO migration). `resolveBaseUrl(c.env, settings, c.req.url)` in
  `src/lib/base-url.ts` builds absolute URLs.
- **Audit today:** `audit_log` (`schema.ts:25-41`): principalId, tokenId, surface, action, resource,
  allowed 0/1, createdAt; append-only, no retention. Read: `recentAudit(db, limit=100)`
  (`queries/audit.ts`) → `access.listAudit` gated `manage_access` (`services/access/index.ts:265`)
  → last-30 table at `/admin/access` (`routes/admin/access/index.tsx:346-381`) — the template for
  the activity page. `api_tokens.lastUsedAt` exists (`schema.ts:94`) and `resolvePrincipal`
  (`src/lib/api-auth.ts:29-56`) stamps it.
- **wrangler.jsonc:** bindings `DB` (D1 `remill`), `MEDIA` (R2), `RATE_LIMIT` (KV); vars `BASE_URL`;
  `compatibility_flags: ["nodejs_compat"]`; `env.preview` mirrors bindings; **no cron triggers, no
  `scheduled()` handler anywhere**. `src/main.tsx` currently ends `export default app`.
- **OpenAPI** (`src/lib/openapi.ts:68-87`): regenerated per request; per-collection paths automatic;
  **static endpoints must be hand-added** to `generateOpenApi` paths.
- **Deny/validation shapes (all surfaces):** 403 `{error, code:'FORBIDDEN', missing:{action,
  collection}}`; 400 `{error, code:'VALIDATION', issues}`; MCP maps them into tool-error payloads.

---

## Cross-cutting infrastructure (built once, in the phase that first needs it)

### CC-1. Cron + `scheduled()` dispatcher — lands in Phase 2
- `wrangler.jsonc`: add `"triggers": { "crons": ["* * * * *", "0 3 * * *"] }`; mirror in
  `env.preview`. Per-minute = scheduled-publish drain (activated Phase 5; no-op until then);
  daily 03:00 UTC = maintenance (trash purge Phase 2, events prune Phase 7).
- `src/main.tsx`: replace `export default app` with
  `export default { fetch: app.fetch, scheduled: (controller, env, ctx) =>
  ctx.waitUntil(runScheduled(controller.cron, env)) } satisfies ExportedHandler<Env>`.
- New `src/jobs/index.ts`: `runScheduled(cron, env)` dispatches on the cron expression string.
  Jobs call **services only**; each job try/caught + `console.error` so one failure doesn't kill
  the batch. Jobs are plain functions — unit-test directly with the vitest D1 harness.
- New `src/config/retention.ts`: `TRASH_RETENTION_DAYS = 30`, `EVENTS_RETENTION_DAYS = 30` (P7).

### CC-2. System actor — lands in Phase 5 (decision D30)
- `src/access/types.ts`: add `'system'` to `Surface` and to `Principal.kind`.
- New `systemPrincipal(): Principal` factory next to `anonymousPrincipal` —
  `{ id: 'system', kind: 'system', surface: 'system' }`. No DB row, no seeded permissions.
- `src/access/authorize.ts`: one new branch — `principal.kind === 'system'` skips permission
  resolution, mints the Grant, **still writes the single audit row** (allowed=1). Witness
  discipline and the "authorize is the only audit writer" invariant both survive.
- Maintenance purges (trash/events) are NOT authorization decisions: they run as **witness-free
  query functions** (precedent: `getSingletonData`) and write no audit rows. Document in
  ACCESS_CONTROL.md.
- `refuseAgentEscalation` untouched (system is not `kind:'agent'`). Check `src/db/seed.test.ts`
  in case Surface serialization is drift-guarded.

### CC-3. Per-page head threading — lands in Phase 6 (decision D36)
- `PageHead` type: `{ title?, description?, canonical?, ogType?: 'website'|'article', ogImage?,
  feedUrl? }`. Augment Hono's `ContextRenderer` so `c.render(content, head)` typechecks.
- `RootLayout = jsxRenderer(({ children, ...head }) => …)`: `<title>{head.title ?? 'remill'}
  </title>`, description meta fallback to current static text, `og:*` + `<link rel="canonical">` +
  `<link rel="alternate" type="application/rss+xml">` only when set. Routes compose the full title
  string themselves (`` `${docTitle} — ${settings.siteName}` ``); the layout does no DB reads.
  Existing `c.render(<…/>)` calls need zero changes.

### CC-4. Shared permission-set compiler — lands in Phase 2
- `src/services/access/index.ts`: `collectionsWithAction(db, principal, action):
  Promise<'*' | string[]>` — resolves `getPrincipalPermissions`, intersects `tokenScope` via
  `scopeMatches`, returns `'*'` for wildcard grants else slug list; for `read`, unions `publicRead`
  collections from live defs. Consumers: trash listing (`delete`, P2), events read filter
  (`read`, P7), cross-collection search (`read`, P1 — if built in P1 first, place the helper there).

### CC-5. Per-route body limits — lands in Phase 3
- `src/lib/api.ts`: keep `MAX_JSON_BODY_BYTES = 1 MiB`; add `MAX_MCP_BODY_BYTES = 8 MiB` and
  `MAX_IMPORT_BODY_BYTES = 10 MiB`; `assertBodyWithinLimit` gains optional `limit` param.
  `src/routes/mcp.tsx:21` passes the MCP limit; the import route (P8) passes the import limit.

---

## Phase 1 — Query power: filter operators + FTS5 search — **DONE 2026-07-08**

**Goal:** ranges/contains/in on all list surfaces; full-text search on REST (`?q=`), MCP
(`search_<slug>`), and admin (`/admin/search` + header box).

**Filter operators.** Extend `ListFilter` with `op: 'eq'|'gte'|'lte'|'contains'|'in'` (default
`eq`); branch `indexFilter` (`queries/documents.ts:187-190`): gte/lte → `>=`/`<=` on the
kind-matched column (ISO datetime text compares lexically — correct); `contains` →
`value_text LIKE '%'||?||'%' ESCAPE '\'` with `%_\` escaped in the input, 400 if the field is
numeric-kind; `in` → comma-split (cap 20 values) `IN (…)`. REST syntax `?filter[field][op]=value`
parsed in `lib/api.ts:60-82` (bare `filter[field]=v` stays `eq`); thread ops through the service
(:512-516) — `assertIndexed` unchanged (unindexed → 400). MCP `list_<slug>` gains a
`filters: array of {field, op, value}` arg (it passes NO filters today, tools.ts:125-148).
Documented caveat: `contains` on markdown/html sees only the 200-char `toIndex` lead-in; full text
lives in `?q=`.

**FTS5 table.** Plain (standalone) FTS5 table — NOT contentless/external-content (plain supports
ordinary INSERT/DELETE with no trigger machinery; storage duplication irrelevant at this scale):
```sql
CREATE VIRTUAL TABLE document_fts USING fts5(
  document_id UNINDEXED, collection UNINDEXED, title, body,
  tokenize='unicode61 remove_diacritics 2'
);
```
Created via `bunx drizzle-kit generate --custom` → hand-written `0007_*.sql`. **Keep it OUT of
`src/db/schema.ts`** — drizzle-kit diffs schema.ts and would emit spurious DDL; FTS is managed
raw-only (precedent: hand-added CHECK constraints). FTS5 is the sanctioned escape hatch per
DATABASE_STANDARDS.md:66.

**Sync.** `insertDocument`/`updateDocument` batches gain two raw items:
`db.run(sql\`DELETE FROM document_fts WHERE document_id = ${id}\`)` then the INSERT with title/body.
`deleteDocument` becomes a 2-item batch `[delete documents, delete fts row]` — **mandatory: FK
cascade cannot clear a virtual table** (Phase 2 replaces this function with the trash batch, which
must also carry the FTS delete). If collection deletion exists in `services/collections`, add
`DELETE FROM document_fts WHERE collection = ?` there too.

**Text extraction.** New optional `toSearchText?: (value: unknown) => string | null` on the
FieldType interface (`src/fields/types.ts`) — SCHEMA_ENGINE change. Implement for text/markdown/
html (full plain text — strip markdown syntax via a small regex-based stripper in
`src/lib/markdown/`); other types fall back to their `toIndex` text. Service-side
`buildSearchText(def, data): {title, body}` next to `buildIndex`: `title` = the title field's value
(see `titleFieldOf`, CC in Phase 6 — for Phase 1 place the helper in `src/lib/def-helpers.ts`
directly), `body` = all searchable fields' text joined with `'\n'`.

**Query escaping.** New `src/lib/fts.ts`: `toFtsQuery(input)` — trim, split on whitespace, each
token double-quoted with internal `"` doubled, last token suffixed `*` (prefix match), joined by
space (implicit AND). Never pass raw user input to MATCH.

**Permission composition.** New `src/db/queries/search.ts`: `searchDocuments(db, {match, scopes:
{collection, accessFilter?: SQL, status?}[], limit, offset}, _grants: Grant[])` — single SQL
joining FTS→documents so compiled ACL applies in-query:
```sql
SELECT d.*, f.collection, snippet(document_fts, 3, char(1), char(2), '…', 12) AS snip
FROM document_fts f JOIN documents d ON d.id = f.document_id
WHERE document_fts MATCH ? AND ((f.collection = ? AND <accessFilter_1>) OR …)
ORDER BY bm25(document_fts, 0, 0, 5.0, 1.0) LIMIT ? OFFSET ?
```
Service mints one Grant per included collection via a single `getPrincipalPermissions` +
`preResolved` authorize calls (one audit row per collection per search — acceptable; searches are
form submits, not keystrokes). Snippet safety: sentinels `char(1)/char(2)`, HTML-escape the whole
snippet server-side, then replace sentinels with `<mark>`/`</mark>`. bm25 order ⇒ offset pagination
only; `q` combined with custom `sort` → 400 VALIDATION.

**Surfaces.** REST: `?q=` on the per-collection list (document in OpenAPI). MCP: generated
`search_<slug>` tool gated `read` (follows the `<verb>_<slug>` convention + permission
intersection). Admin: header search box in `admin-shell.tsx` (GET form → `/admin/search`,
`id="admin-search-input"`); new route `src/routes/admin/search/index.tsx` (results grouped by
collection, snippets marked); `src/client/init.ts` gains a `/` + cmd/ctrl-K focus handler (skip
when focus is already in an editable element). *Noted alternative (not built): a single static
cross-collection MCP `search` tool.*

**Backfill.** Migration creates the empty table; new admin-only "Rebuild search index" button on
`/admin/settings` (POST, `requireRole('admin')`) → `rebuildSearchIndex(db)` service — cursor-pages
all documents 200/batch, recomputes searchText, DELETE+INSERT per batch. Run once post-deploy
(note in the migration header).

**Files.** New: `src/lib/fts.ts`, `src/db/queries/search.ts`, `src/routes/admin/search/index.tsx`,
`src/lib/def-helpers.ts`, migration `0007`. Modified: `src/fields/types.ts` +
`src/fields/{text,markdown,html}.tsx`, `src/services/documents/index.ts`,
`src/db/queries/documents.ts`, `src/services/collections/index.ts` (if deletion exists),
`src/lib/api.ts`, `src/mcp/tools.ts`, `src/components/layouts/admin-shell.tsx`,
`src/client/init.ts`, `src/routes/admin/settings/index.tsx`, `src/lib/openapi.ts`.

**Verify.** Unit: toFtsQuery escaping (quotes, empty, unicode); operator SQL per column kind;
contains-on-numeric 400; in-cap 400; search ACL (author fixture sees only readable rows; drafts of
others invisible); snippet HTML-escape. E2E: new `e2e/search.spec.ts` (`/` focuses box; results
page shows seeded doc; author sees permission-filtered results); axe: `/admin/search`. Manual:
`curl '…/api/c/<slug>?q=hello&filter[<numfield>][gte]=10' -H 'Authorization: Bearer …'`; MCP
`tools/list` shows `search_<slug>`; rebuild button then search finds pre-existing seeded docs.

**Steering:** DATABASE_STANDARDS (FTS5 raw-only table, batch-sync rule, rebuild path),
SCHEMA_ENGINE (`toSearchText`), API_AND_MCP_STANDARDS (`q`, operator syntax, contains caveat,
`search_<slug>`). Decision **D28**.

## Phase 2 — Cron infra + recoverable delete (trash) — **DONE 2026-07-08**

**Goal:** delete becomes recoverable everywhere; cron/maintenance scaffolding exists (CC-1, CC-4).

**Schema** (normal drizzle migration `0008`; table goes in `schema.ts`): `document_trash` —
`id` PK (`newId('trash')`), `documentId` (original id, UNIQUE index), `collection` TEXT **no FK**
(snapshot must survive collection deletion; restore 409s if the def is gone), `dataJson`, `status`,
`revisionsJson` (newest `TRASH_MAX_REVISIONS = 20` revisions — keeps rows well under D1 row-size
limits), `createdBy`, `createdAt`, `updatedAt`, `publishedAt`, `deletedBy`, `deletedAt`.
Indexes: `deletedAt`, `collection`.

**Delete flow** (`services/documents/index.ts:799-811`): authorize read → load doc → authorize
delete → load newest 20 revisions → new query `trashDocument(db, input, _grant)` = one `db.batch`:
INSERT `document_trash` + `DELETE FROM document_fts WHERE document_id=?` + DELETE `documents` row
(FK cascades clear index/revisions/item_grants). Remove the old hard `deleteDocument` query.
Read paths untouched — that is the point of the trash-table model.

**Restore** — direct query path, NOT the create pipeline (def drift must not block recovery):
service `restoreDocument(db, principal, trashId, now)` → authorize `delete` on the collection →
verify def exists (409 CONFLICT if not) → recompute index via `buildIndex` against the *current*
def (skip data keys absent from the def) → recompute searchText → query `restoreTrashedDocument`
batch: INSERT documents (original id + timestamps, `updatedAt = now`), index rows, FTS row,
re-INSERT snapshotted revisions, DELETE trash row. Same original `documentId` ⇒ relations/backlinks
resume. PK collision (doc re-created meanwhile) → catch unique-constraint → 409.

**Who:** trash listing + restore + purge-one gated by **`delete` on the collection** (symmetric:
who can delete can undelete); listing filtered via `collectionsWithAction(…, 'delete')` (CC-4)
compiled to `WHERE collection IN (…)`. No `requireRole('admin')` on the page — rows the caller
can't act on simply don't appear.

**Retention:** daily maintenance job `purgeExpiredTrash` → witness-free
`DELETE FROM document_trash WHERE deleted_at < ?` (30 days, `src/config/retention.ts`).
*Noted alternative: a settings field for retention — skipped to avoid settings sprawl.*

**Surfaces.** Admin: `/admin/trash` (nav item "Trash"; classic `method="post"` + hidden `op`
dispatch per the access-pages template; Restore + "Delete forever" buttons; empty state).
REST: `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id` (hand-add to
OpenAPI static paths). MCP: generated `delete_<slug>` tool gated `couldDo(delete)`, description
"Moves to trash; recoverable for 30 days". Restore stays admin/REST-only in v1 (*noted
alternative: an MCP restore_trash tool*).

**Files.** New: `src/jobs/index.ts`, `src/config/retention.ts`, `src/db/queries/trash.ts`,
`src/services/trash/index.ts`, `src/routes/admin/trash/index.tsx`,
`src/routes/api/trash/index.tsx` + `src/routes/api/trash/[id]/restore.tsx`, migration `0008`.
Modified: `wrangler.jsonc` (triggers, both envs), `src/main.tsx` (ExportedHandler shape),
`src/db/schema.ts`, `src/services/documents/index.ts`, `src/db/queries/documents.ts`,
`src/services/access/index.ts` (CC-4), `src/mcp/tools.ts`,
`src/components/layouts/admin-shell.tsx`, `src/lib/openapi.ts`.

**Verify.** Unit: delete→trash atomicity (doc gone; index/revisions gone via cascade; FTS row
gone; trash row complete incl. revisionsJson); restore round-trip (revisions back, relations by id
resolve again); restore-after-collection-delete 409; double-restore 409; purge honors 30d cutoff;
delete-permission gating (author can trash/restore own-permitted collections only). E2E: new
`e2e/trash.spec.ts` (delete from editor → row in /admin/trash → restore → doc back in list); axe:
`/admin/trash`. Manual: MCP `delete_<slug>` then REST `GET /api/trash` shows the row.

**Steering:** DATABASE_STANDARDS (trash snapshot pattern), ACCESS_CONTROL (delete-gates-restore;
witness-free maintenance queries), API_AND_MCP_STANDARDS (trash endpoints + delete tool).
Decisions **D29**, **D31**.

## Phase 3 — MCP parity completion (upload + revisions) — **DONE 2026-07-08**

**Goal:** agents can upload media and work with revisions; MCP body cap raised (CC-5).

- **`upload_media`** static tool gated `couldDo(create, 'media')`: args `{filename, alt?,
  content_base64}`. New `src/lib/base64.ts` `decodeBase64(b64): Uint8Array` using
  `Buffer.from(b64, 'base64')` (nodejs_compat confirmed) with strict charset pre-validation →
  `InputValidationError` on garbage. Calls `uploadMedia` service **unchanged** (MIME sniff, 25 MiB
  cap, alt-required all reused). Body cap: `/mcp` passes `MAX_MCP_BODY_BYTES = 8 MiB` (≈6 MiB
  effective file after base64 inflation); tool description states the limit and points to REST
  multipart for larger files. Rate limit: extract the KV consume logic from
  `src/middleware/rate-limit.ts` into exported `consumeRateLimit(kv, bucket, key, config)` used by
  both the middleware and this handler, keyed `upload:${principal.tokenId ?? ip}`, same 30/60s
  config → structured 429 tool error.
- **`revisions_<slug>`** `{id}` gated `read` → existing `listRevisions` service.
- **`restore_<slug>`** `{id, revision}` gated `update` → existing `restoreRevision` service
  (it delegates to updateDocument, so `update` is the right action).

**Files.** New: `src/lib/base64.ts`. Modified: `src/lib/api.ts`, `src/routes/mcp.tsx`,
`src/middleware/rate-limit.ts`, `src/mcp/tools.ts`.

**Verify.** Unit: base64 decode/reject; tool visibility per token scope (scoped token without
media create doesn't see upload_media); revisions/restore handlers happy + forbidden paths.
Manual: JSON-RPC `tools/call upload_media` with a small PNG (alt required enforced); >8 MiB body →
structured error; confirm the 25 MiB service cap still enforced post-decode.

**Steering:** API_AND_MCP_STANDARDS (upload tool, body-cap table), SECURITY_STANDARDS (per-surface
body limits). Decision **D34**.

## Phase 4 — Audit surfacing + token last-used — **DONE 2026-07-08**

**Goal:** the audit trail becomes legible: activity page, dashboard feed, REST/MCP read, token
last-used column.

- **Migration `0009`:** add nullable `collection` TEXT column to `audit_log` + index on
  `(created_at)`. `appendAudit` writes `resource.collection` (always known per `Resource` type)
  into it. This makes collection filtering clean — `resource` strings (`document:<id>`) don't
  carry the collection. Old rows have NULL collection; the UI treats NULL as "—".
- **Query:** `listAuditPage(db, {principalId?, action?, allowed?, collection?, cursor?, limit})`
  in `src/db/queries/audit.ts` — keyset cursor on `(createdAt, id)`, newest first.
- **Service:** extend `access.listAudit` with filters/pagination, still gated `manage_access`.
- **Admin:** new `/admin/activity` page (nav item "Activity", admin role in `NAV_BY_ROLE`):
  filter selects (principal, action, allowed, collection) as a GET form + paginated table —
  the `/admin/access` audit table (:346-381) is the rendering template. Dashboard
  (`routes/admin/index.tsx:44-54`): replace the EmptyState placeholder with `recentAudit(10)`
  rows for admins (EmptyState stays for non-admins).
- **REST:** `GET /api/audit?since…filters` gated `manage_access` (OpenAPI static path).
  **MCP:** static `list_audit` tool gated `couldDo(manage_access, '*')`.
- **Tokens:** add "Last used" column (`formatDate(lastUsedAt)`, "never" fallback) to the tokens
  table in `/admin/access`. First verify stamping fires on a live token call (it should — 
  `resolvePrincipal` stamps it; api-auth.ts:29-56).

**Files.** New: `src/routes/admin/activity/index.tsx`, `src/routes/api/audit/index.tsx`,
migration `0009`. Modified: `src/db/schema.ts`, `src/db/queries/audit.ts`,
`src/access/authorize.ts` (appendAudit call carries collection), `src/services/access/index.ts`,
`src/routes/admin/index.tsx`, `src/routes/admin/access/index.tsx` (last-used column),
`src/mcp/tools.ts`, `src/components/layouts/admin-shell.tsx`, `src/lib/openapi.ts`.

**Verify.** Unit: filter/cursor combos; non-admin 403; deny rows appear (allowed=0). E2E: new
`e2e/activity.spec.ts` (admin sees rows including a deny row; author gets 403/redirect; dashboard
card renders rows); axe: `/admin/activity`. Manual: `curl '/api/audit?allowed=0'` with admin token;
make one MCP call with a token, confirm "Last used" updates.

**Steering:** API_AND_MCP_STANDARDS (audit endpoint/tool), ACCESS_CONTROL (audit exposure gated
`manage_access`; the new collection column).

## Phase 5 — Scheduled publishing — **DONE 2026-07-08**

**Goal:** `publish_at` on drafts; per-minute drain publishes them with full audit attribution.
Builds CC-2 (system actor).

- **Migration `0010`:** `documents.publish_at` TEXT nullable (+ hand-added partial index
  `CREATE INDEX documents_publish_at ON documents(publish_at) WHERE publish_at IS NOT NULL`).
- **Semantics:** pending = `status='draft' AND publish_at IS NOT NULL`. Manual publish clears it;
  unpublish leaves it null; scheduling a published doc → 400; past `publish_at` → publishes on
  next drain (allowed; documented). Requires the `publish` action: new service
  `scheduleDocument(db, principal, collection, id, publishAt | null, now)` (null = cancel);
  requires `hasLifecycle(def)`.
- **Drain** (`src/jobs/publish.ts`, per-minute cron): witness-free *selection* query for due docs
  (`status='draft' AND publish_at <= now`, LIMIT 50) then per doc
  `setPublished(db, systemPrincipal(), collection, id, true, now)` — full validation + revision +
  one audit row per publish (surface `'system'`); `publish_at` cleared in the same update.
  Failures logged; loop continues.
- **UI:** EditorSidebar publish section (drafts with `draftPublish` only): `datetime-local` input
  (reuse `datetimeLocalToIso`/`isoToDatetimeLocal` from `src/fields/datetime.tsx`) + Schedule
  button → native form POST `/admin/c/:collection/:id/schedule`; when pending, show
  "Scheduled for {date}" + Cancel button (same route, `op=cancel`).
- **REST:** `POST /api/c/:collection/:id/schedule` body `{publishAt: string | null}` (add to the
  per-collection OpenAPI generator). **MCP:** generated `schedule_<slug>` tool
  `{id, publish_at?, cancel?}` (exactly one of the two required — validate in handler), gated
  `couldDo(publish)`, offered only when `hasLifecycle(def)`.
- Surface `publishAt` in document payloads (`toDomain` mapper + REST/MCP outputs).

**Files.** New: `src/jobs/publish.ts`, `src/routes/admin/c/[collection]/[id]/schedule.tsx`,
`src/routes/api/c/[collection]/[id]/schedule.tsx`, migration `0010`. Modified:
`src/access/types.ts` + `src/access/authorize.ts` + system principal factory (CC-2),
`src/db/schema.ts`, `src/db/queries/documents.ts`, `src/services/documents/index.ts`,
`src/components/admin/editor-sidebar.tsx`, `src/mcp/tools.ts`, `src/jobs/index.ts`,
`src/lib/openapi.ts`; check `src/db/seed.test.ts`.

**Verify.** Unit: schedule validation (published doc 400; permission deny audited); drain
publishes due drafts with system audit rows + clears publish_at; drain skips future docs; cancel
clears. E2E: new `e2e/scheduled-publish.spec.ts` (set schedule in sidebar → pending state visible →
cancel). Manual: set publish_at 1 min out locally and invoke the drain via the unit harness
(don't depend on live cron in dev).

**Steering:** ACCESS_CONTROL (system actor section), API_AND_MCP_STANDARDS (schedule tool +
endpoint), DATABASE_STANDARDS (partial index). Decisions **D30**, **D32**.

## Phase 6 — Public discovery: feeds, sitemap, OG meta, `/` index — **DONE 2026-07-08**

**Goal:** published content becomes findable and shareable. Builds CC-3 (head threading).

- **Routes:** hand-register `GET /rss.xml`, `/sitemap.xml`, `/robots.txt` in `src/main.tsx`
  (openapi.json precedent — feed readers expect literal dotted paths). Handlers call services with
  `anonymousPrincipal('rest')` — ACL identical to public pages; public CSP applies automatically
  (no PROTECTED_PREFIXES change; note the intentionality in SECURITY_STANDARDS).
- **XML builders** in new `src/lib/feeds.ts` — pure functions (settings + rows → XML string), all
  values XML-escaped. RSS 2.0, single site feed merging all `publicRead && hasLifecycle`
  collections, published docs only, `publishedAt DESC`, limit 50; `?collection=slug` narrows
  (404 if not publicRead). Item: title via `titleFieldOf(def)`, link via
  `publicUrlOf(def, doc, baseUrl)` (slug-field value if the def has a `slug`-key field, else
  `/{collection}/{doc.id}` — the public route accepts ids), description = excerpt, pubDate, guid =
  doc id. **Always-on** — publicRead is already the opt-in; an empty feed is valid. *(Noted
  alternatives: Atom; a feedsEnabled setting.)*
- **sitemap.xml:** `/` + every published doc of publicRead collections (`loc`, `lastmod` =
  updatedAt), cap 5000. **robots.txt:** `User-agent: *`; `Disallow: /admin`, `/api`, `/mcp`,
  `/auth`, `/s/`; `Sitemap: {siteUrl}/sitemap.xml`.
- **Def helpers** (`src/lib/def-helpers.ts`, started in P1): `titleFieldOf(def)` = first text-type
  field with `showInList`, else first text field, else undefined (fall back to doc id);
  `excerptOf(def, data)` = first markdown/text field's search text, whitespace-collapsed,
  truncated 160 chars; `publicUrlOf(def, doc, baseUrl)`. *(A def-level `titleField` override is a
  noted alternative — heuristic first.)*
- **Head props (CC-3):** public doc page sets `{title: '${docTitle} — ${siteName}', description:
  excerpt, canonical, ogType:'article', ogImage: first media field value → '/media/<id>',
  feedUrl:'/rss.xml'}`.
- **`/` index** (`src/routes/index.tsx`): if no publicRead collections exist keep
  `c.redirect('/admin')`; else render a PublicShell homepage — siteName/description masthead,
  per-collection recent published docs (title/date/link), head props set.

**Files.** New: `src/lib/feeds.ts`. Modified: `src/layouts.tsx` (+ module augmentation),
`src/main.tsx`, `src/routes/index.tsx`, `src/routes/[collection]/[slug]/index.tsx`,
`src/lib/def-helpers.ts`, `src/components/layouts/public-shell.tsx` (only if the homepage needs a
list variant).

**Verify.** Unit: XML escaping; feed excludes drafts + non-publicRead + lifecycle-none
collections; publicUrlOf slug/id fallback; robots content. E2E: new `e2e/public-discovery.spec.ts`
(rss.xml 200 + contains seeded published doc; sitemap contains it; `/` renders for publicRead
seed; og:title + canonical present on the doc page; **anonymous never sees a draft in feed/
sitemap/homepage**). Manual: `curl -s 127.0.0.1:3100/rss.xml | head`.

**Steering:** SECURITY_STANDARDS (three intentional new public routes). Decisions **D35**, **D36**.

## Phase 7 — Events outbox — **DONE 2026-07-08**

**Goal:** a poll-based change feed: "what changed since seq N", permission-filtered.

- **Migration `0011`** (`events` in schema.ts): `seq` INTEGER PRIMARY KEY **AUTOINCREMENT**
  (monotonic cursor, never reused — documented exception to the nanoid-PK convention), `type`
  TEXT (`document.created|updated|deleted|restored|published|unpublished`, `media.created|deleted`,
  `collection.created|updated|deleted`), `collection` TEXT (affected slug; `'media'` for media),
  `resource` TEXT (document/media/collection id), `principalId` TEXT, `createdAt` TEXT; index on
  `createdAt`. **Pointers only, no payload** — consumers re-fetch via existing read tools; a
  payload snapshot would leak data the poller can't read *now*.
- **Write mechanics (layering-preserving):** services build `EventInput {type, collection,
  resource, principalId, at}` and pass it into queries-layer mutation inputs
  (`InsertInput`/`UpdateInput`/trash/restore inputs gain optional `event?: EventInput`); queries
  append `db.insert(events).values(…)` to the existing atomic batch. Media upload/delete and
  collection create/update/delete wrap their single statements in 2-item batches. Scheduled
  publishes flow through `setPublished` → instrumented automatically.
- **Read:** `GET /api/events?since=<seq>&collection=<slug>&limit=` — clamp limit (default 100, max
  500); `WHERE seq > since [AND collection = ?] AND collection IN (<readable>)` ORDER BY seq ASC;
  readable set via `collectionsWithAction(…, 'read')` (`'*'` → no predicate). Response
  `{data, nextSince}` (`nextSince` = last seq, or echoes `since` when empty). Pruned horizon ⇒
  gaps are legal; document it. OpenAPI static path.
- **MCP:** static `poll_events {since?, collection?, limit?}` tool, offered to all token
  principals; same permission-filtered service.
- **Retention:** daily `pruneEvents` (witness-free, `EVENTS_RETENTION_DAYS = 30`).

**Files.** New: `src/db/queries/events.ts`, `src/services/events/index.ts`,
`src/routes/api/events/index.tsx`, migration `0011`. Modified: `src/db/schema.ts`,
`src/db/queries/documents.ts` + `trash.ts` + media/collections queries (event in batch),
`src/services/documents/index.ts` + `trash` + `media` + `collections` services (construct
EventInput), `src/mcp/tools.ts`, `src/jobs/index.ts`, `src/config/retention.ts`,
`src/lib/openapi.ts`.

**Verify.** Unit: every mutation type emits exactly one event in-batch (create/update/trash/
restore/publish/unpublish/media/collection); seq monotonic; `since` cursor exact; per-collection
filtering incl. wildcard, publicRead, and tokenScope mask; prune. Manual: mutate via MCP, then
`curl '/api/events?since=0'` with a collection-scoped token → only that collection's events.

**Steering:** DATABASE_STANDARDS (AUTOINCREMENT-seq exception; outbox-in-batch rule),
API_AND_MCP_STANDARDS (events endpoint/tool, gap semantics). Decision **D33**.

## Phase 8 — Import/export + snapshot — **DONE 2026-07-08**

**Goal:** data egress/ingress as a product feature; full-site snapshot to R2.

- **Format:** NDJSON, one collection per file. Line 1 header `{"kind":"remill-export","version":1,
  "exportedAt":…,"collection":<full def>}`; then per line `{"kind":"document","id","status",
  "data","createdAt","updatedAt","publishedAt","createdBy"}`. *(JSON envelope rejected — not
  streamable/diffable.)*
- **Export:** service `exportCollection(db, principal, slug)` — authorize read +
  `compileReadFilter`; cursor-loop 200/page; **you export exactly what you can read** (own drafts
  included if visible). REST `GET /api/c/:collection/export` (`application/x-ndjson`; OpenAPI
  static); admin Export button on the collection list header → `GET /admin/c/:collection/export`
  with `Content-Disposition: attachment`. In-memory string build is fine at this scale
  (*streaming noted as future*).
- **Import:** `POST /api/c/:collection/import` (body limit `MAX_IMPORT_BODY_BYTES` 10 MiB — larger
  imports split into files; documented) + admin page `/admin/c/:collection/import` (file input,
  classic form). **Upsert by id**: id present + exists → `updateDocument`; else `createDocument`
  with **preserved id** (extend the create service input with optional `id` validated
  `/^doc_[A-Za-z0-9_-]+$/`; omitted → new id). Every line runs the full validated pipeline with
  per-item authorize (create/update). Header def slug must match the target collection → 400;
  import never mutates the def. `?dryRun=1` validates only. Response `{created, updated, failed,
  errors: [{line, id?, error}]}` — per-line errors, run does not abort. New rate bucket
  `'import'` 10/60s.
- **Snapshot:** service `snapshotSite(db, r2, now)` admin-gated: every collection def + ALL docs
  (unfiltered — caller is admin) + the settings doc → R2 keys
  `snapshots/<ISO-timestamp>/<slug>.ndjson` + `manifest.json` (collections, counts, and the note:
  **media binaries excluded — metadata only**). Reuses the `MEDIA` binding (prefix-separated).
  Manual button on `/admin/settings` (`requireRole('admin')`). Cron snapshot NOT wired in v1 —
  leave a one-line hook point in `runScheduled` with a comment.

**Files.** New: `src/lib/ndjson.ts` (serialize/parse-with-line-numbers),
`src/services/transfer/index.ts`, `src/routes/api/c/[collection]/export.tsx` + `import.tsx`,
`src/routes/admin/c/[collection]/import.tsx` + export handler. Modified:
`src/services/documents/index.ts` (optional preserved id), `src/routes/admin/c/[collection]/
index.tsx` (Export button), `src/routes/admin/settings/index.tsx` (Snapshot button),
`src/lib/api.ts`, `src/middleware/rate-limit.ts` (bucket), `src/lib/openapi.ts`.

**Verify.** Unit: export respects compiled read filter (author exports own drafts, not others');
round-trip export→import into an empty collection preserves ids/status/data timestamps; upsert
updates existing; per-line error report + dryRun writes nothing; def-slug mismatch 400; bad id
format rejected. E2E: new `e2e/import-export.spec.ts` (download via admin; upload; imported doc
listed); axe: import page. Manual: Snapshot button then `wrangler r2 object list` locally.

**Steering:** API_AND_MCP_STANDARDS (NDJSON format spec verbatim; size limits). Decision **D37**.

## Phase 9 — Editor islands: CodeMirror + media picker

**Goal:** the two plain-input embarrassments become real widgets. Implements D13; supersedes D12.

- **Deps:** `bun add codemirror @codemirror/lang-markdown` (nothing else). Vite-bundled,
  self-hosted, CSP-safe.
- **Markdown island** (`src/client/markdown-editor.ts`): `src/fields/markdown.tsx` wraps the
  Textarea in `<div data-md-editor data-label-id={…}>` — the Textarea (with `data-bind`) **stays
  in the DOM**, visually hidden with `sr-only` (NOT `display:none`; stays programmatically
  reachable). Island: for each `[data-md-editor]`, create an `EditorView` seeded from
  `textarea.value`; extensions: basicSetup-minus-lineNumbers, `markdown()`,
  `EditorView.contentAttributes.of({'aria-labelledby': labelId})`, a theme mapping the existing
  Tailwind CSS variables (light/dark follows `data-theme`). **Sync back (DATASTAR_PATTERNS §g):**
  updateListener → `textarea.value = doc.toString(); textarea.dispatchEvent(new Event('input',
  {bubbles:true}))` — the Datastar signal updates; whole-form `@post` unchanged.
- **Media picker** (`src/client/media-picker.ts`): `src/fields/media.tsx` keeps the id Input
  (data-bind) + thumbnail; adds a "Browse media" Button opening a `Dialog` whose body loads a
  server-rendered fragment via Datastar `@get('/admin/media/picker')` (thumbnail grid + pagination
  + search box; each tile a `<button data-media-id data-media-url>`). New fragment route
  `src/routes/admin/media/picker.tsx` (`requireAuth()`) + co-located `POST /admin/media/picker/
  upload` (session-authed, calls `uploadMedia` — do NOT use `/api/media`, which is token-authed).
  Island does only what hypermedia can't: `dialog.showModal()/close()`, the native file-input
  upload POST (FormData) + grid refresh, and on tile click writing `data-media-id` into the field
  input + dispatching `input`. Wrapper carries `data-media-picker-for={inputId}`.
- **Script loading rule:** `<Script src="/src/client/markdown-editor.ts">` and
  `<Script src="/src/client/media-picker.ts">` added in the **route files**
  `src/routes/admin/c/[collection]/[id]/index.tsx` AND the new-document route — never in shared
  components (vite-ssr-components only discovers Scripts in layouts.tsx + routes/**).

**Verify.** Unit: picker fragment ACL. E2E: new `e2e/editor-islands.spec.ts` (type in CodeMirror →
save → value persisted, proving the §g sync; open picker → select tile → input value set; upload
inside picker appears in grid); axe on the editor page + picker-open state; keyboard-only pass.
Manual: dark-mode CodeMirror theme.

**Steering:** DATASTAR_PATTERNS (add the two worked island examples), DESIGN_SYSTEM (editor
tokens). Decision **D38** (D13 implemented; **D12 superseded**).

## Phase 10 — Revision diff viewer

**Goal:** choosing what to restore stops being guesswork.

- **Diff:** hand-rolled LCS line diff, no dependency — new `src/lib/diff.ts` (~60 lines:
  line-split, DP table capped at 5,000 lines/side — beyond cap render "too large to diff"; output
  unified op list `{kind:'same'|'add'|'del', line}`). Unit-tested thoroughly.
- **UI:** new route `GET /admin/c/[collection]/[id]/revisions?from=&to=` (defaults: latest two).
  Uses the existing `listRevisions` service (authorize read inside). For each field key in the
  union of both revisions: value → string (strings verbatim; everything else
  `JSON.stringify(v, null, 2)`) → diff → render per-field Cards; added lines `<ins>`, removed
  `<del>` (semantic elements, styled with the existing tone tokens). From/to = two Selects in a
  GET form. EditorSidebar revisions header gains a "Compare" link. No REST change
  (`GET /api/c/:c/:id/revisions` already exists).

**Files.** New: `src/lib/diff.ts`, `src/routes/admin/c/[collection]/[id]/revisions.tsx`.
Modified: `src/components/admin/editor-sidebar.tsx`.

**Verify.** Unit: LCS correctness (adds/dels/unchanged, empty sides, cap behavior); field-union
rendering (field present in only one revision). E2E: edit a doc twice → compare shows the changed
line; axe: revisions page.

## Phase 11 — Bulk actions on admin lists

**Goal:** select-many → publish/unpublish/trash. Safe because Phase 2 made delete recoverable.

- **Classic form, no signals** (matches the access-pages `op` pattern; avoids Datastar
  signal-naming issues with nanoid ids; works without JS): `GeneratedTable` gains optional
  `selectable` — wraps the table in `<form method="post" action="/admin/c/:collection/bulk">`,
  leading checkbox column (`name="ids" value={doc.id}`, per-row `aria-label` from the title
  field) + header select-all checkbox (`data-on-change` one-liner toggling row checkboxes). Fixed
  bottom bulk bar inside the form: buttons `name="op"` value `publish|unpublish|trash`
  (publish/unpublish only when `hasLifecycle`); copy notes "Trash is recoverable for 30 days" —
  no confirm dialog needed.
- **Endpoint:** `POST /admin/c/[collection]/bulk` (`requireAuth`), parses `ids[]` (cap **100** →
  400) + `op`. Service `bulkDocuments(db, principal, slug, op, ids, now)` loops the existing
  `setPublished` / `deleteDocument` **per id** — per-item authorize + audit + events preserved;
  collects failures; partial failure never rolls back completed items (documented). Redirect back
  with `?bulk=ok:<n>,failed:<m>` → Toast on the list page.
- MCP/REST bulk endpoints: out of scope (per-item tools exist).

**Files.** New: `src/routes/admin/c/[collection]/bulk.tsx`. Modified:
`src/components/admin/generated.tsx`, `src/routes/admin/c/[collection]/index.tsx`,
`src/services/documents/index.ts`.

**Verify.** Unit: per-item authorize (mixed-permission id set → partial result with failures
reported); 100-id cap; op validation. E2E: new `e2e/bulk-actions.spec.ts` (select-all → trash →
rows appear in /admin/trash; publish/unpublish toggles status badges; checkboxes
keyboard-operable); axe re-run on the list page.

**Steering:** DATASTAR_PATTERNS (native-form bulk pattern). Decision **D39**.

---

## Decision-log entries to add (docs/TECH_DECISIONS.md)

- **D28** — List filter operators (gte/lte/contains/in) compile to `document_index` subqueries;
  full-text search via a plain FTS5 table `document_fts` kept out of schema.ts, synced inside the
  existing atomic write batch, bm25-ranked, ACL composed in-query.
- **D29** — Recoverable delete: snapshot doc + last 20 revisions into `document_trash`, hard-delete
  the original (FK cascades clear index/grants); 30-day cron purge; restore is a direct-query
  re-insert under the original id, gated by `delete`.
- **D30** — System actor: `'system'` added to `Surface` and `Principal.kind` (closed-vocabulary
  extension); `authorize()` allows system principals without permission lookup but still writes
  the audit row.
- **D31** — Cron: two triggers (per-minute publish drain, daily 03:00 maintenance) dispatched on
  `controller.cron` in `src/jobs`; jobs call services only; retention purges are witness-free
  maintenance queries that skip audit.
- **D32** — Scheduled publishing via nullable `documents.publish_at`; pending = draft + non-null;
  manual publish clears it; setting requires `publish`.
- **D33** — Events outbox: pointer-only rows, AUTOINCREMENT `seq` cursor (documented exception to
  nanoid PKs), written inside mutation batches, reads filtered to collections the caller can
  `read`, 30-day retention.
- **D34** — MCP body cap raised to 8 MiB (route-specific); `upload_media` takes base64 and reuses
  the REST upload service and its limits.
- **D35** — Feeds/sitemap/robots always-on, hand-registered dotted routes (openapi.json
  precedent); RSS 2.0 single merged feed with `?collection=` narrowing.
- **D36** — Per-page head via `c.render(content, head)` second-arg props with a `ContextRenderer`
  augmentation; routes compose full title strings.
- **D37** — Import/export: NDJSON (header line = def, then documents); export bounded by the
  caller's compiled read filter; import upserts by preserved id through the validated pipeline;
  full-site snapshots to R2 under `snapshots/`, media metadata only.
- **D38** — Editor islands: CodeMirror 6 markdown island (implements D13); **D12 (Uppy)
  superseded** by a native Dialog-based media-picker island using the existing upload service.
- **D39** — Bulk admin actions via native form + per-item service calls (per-item authorize/
  audit), capped at 100 ids; no bulk REST/MCP surface.

## Steering doc update matrix

| Doc | Phases | Content |
|---|---|---|
| DATABASE_STANDARDS | 1,2,5,7 | FTS5 raw-only table + batch-sync rule; trash snapshot pattern; partial index; events AUTOINCREMENT exception + outbox-in-batch |
| SCHEMA_ENGINE | 1 | `toSearchText` FieldType hook |
| ACCESS_CONTROL | 2,4,5 | delete-gates-restore; witness-free maintenance; system actor; audit exposure + collection column |
| API_AND_MCP_STANDARDS | 1,2,3,4,5,7,8 | new endpoints/tools, operator + `q` syntax, body-cap table, NDJSON spec, events semantics |
| SECURITY_STANDARDS | 3,6,8 | per-surface body limits; intentional new public routes; import rate bucket |
| DATASTAR_PATTERNS | 9,11 | island worked examples (CodeMirror, picker); native-form bulk pattern |
| E2E_TESTING | all | new spec inventory + axe-sweep page list |

Also update root `CLAUDE.md`'s build-status paragraph and `docs/PROJECT_BRIEF.md` current-state
section at the end (or via `/wrap-up`).

## Verification protocol (every phase)

1. `bun run type-check && bun run lint && bun run test:run` green.
2. `bun run routes` after any new route file; `bun run db:migrate` after any migration.
3. `bun run build && bun run e2e` green — including the axe sweep with every new admin page added.
4. Exercise the feature end-to-end on the running dev server (the `/verify` skill): the specific
   curl/MCP calls listed in each phase's Verify block.
5. Append the worklog row; update the decision log + steering docs named by the phase **in the
   same commit** as the feature.

## Deferred / out of scope (noted for the record — do NOT implement)

**Tier-4 ideas considered and consciously excluded from this plan:**
- **Semantic search** (Vectorize + Workers AI embeddings, `semantic_search_<slug>`) — do FTS5
  first; revisit only if FTS proves insufficient.
- **B5 composite field types** (`repeater`/`object`) — deferred in the roadmap plan
  (plan.md:259-272); real scope: nested indexing/PATCH-merge/form recursion. Pick up only when a
  concrete collection needs it.
- **Multi-hop graph traversal** (`graph_<slug>` with depth + admin graph view) — single-hop
  backlinks exist; authorize-per-hop design needed first.
- **Image transform variants** — D11 reserved `/media/:id/:variant` + `variants_json`; slot in
  when public pages need responsive images.
- **Cron-scheduled snapshots** — hook point left in `runScheduled`; wire when wanted.
- **MCP trash-restore tool, Atom feeds, per-def `titleField` override, streaming export,
  bulk REST/MCP** — all noted inline above as alternatives.

**Standing non-goals (unchanged, from PROJECT_BRIEF):** multi-tenancy/multi-site, theme/template
system, plugin system, field-level access control, i18n, push webhooks (the events outbox is the
deliberate poll-based alternative), realtime collaboration, video transcoding.

**Operational note carried over:** rotate the Resend API key (memory: exposed during fabric-v2).

## Revision Log

- 2026-07-07: Initial plan (planned interactively; four design forks user-decided; codebase facts
  verified by three exploration passes + spot-checks).
- 2026-07-08: Tier 1 (Phases 1–4) implemented and verified. Deviations from spec: FTS sync uses
  prepared statements through an out-of-schema Drizzle handle (src/db/fts-table.ts) because the D1
  driver cannot batch raw SQL; audit_log gained a denormalized `collection` column (migration 0009)
  for clean activity filtering; trash listing compiles own/published delete-conditions in-query
  (TrashScope) — a security tightening beyond the spec; shared Table wrapper became a focusable
  region (axe scrollable-region-focusable).
- 2026-07-08 (later): Tier 2 (Phases 5–8) implemented and verified (per-phase commits; execution
  overlay in plans/2026-07-08-tier2_scheduled_publishing_events_import/). Deviations from spec:
  the publish drain lives in services/documents, not src/jobs/publish.ts (jobs call services ONLY
  — the purgeExpiredTrash precedent); system-actor revisions carry `saved_by` NULL
  (document_revisions.saved_by FKs principals and the system actor deliberately has no row — the
  audit row is the attribution); Phase 6 added a services/discovery module (routes must not
  compose gated reads) and created def-helpers fresh (Phase 1's RE-PLAN had skipped it); import
  gained a publish gate — `status:'published'` lines require the `publish` action (security
  tightening: import must not bypass "agent drafts, human publishes"); import-create preserves
  id/status/createdAt/publishedAt but not updatedAt; snapshot also writes media.ndjson metadata;
  drive-by: getSettings treats defaultPageSize<1 as unset (empty Datastar number signal stored 0,
  clamping lists to one-row pages).
