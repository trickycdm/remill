# Tier 2 Execution Plan — Phases 5–8 (scheduled publishing, discovery, events outbox, import/export)

## Context

Tier 1 (Phases 1–4) of `plans/2026-07-07-platform_completion_tiered_roadmap/plan.md` is committed
(7f8815d) on `feature/platform-completion-tier1`, tree clean. The user asked to proceed with
Tier 2 = Phases 5–8. **plan.md is the authoritative design** — every decision is pre-made
(D30, D32, D33, D35–D37) and marked do-not-reopen. This document is the *execution overlay*: the
phase order, the verified-against-code drift corrections, and the closeout checklist. Where this
file and plan.md disagree on design, plan.md wins; where plan.md cites stale anchors, the
corrections below win.

**Execution order: 5 → 6 → 7 → 8** (7→8 is a hard dependency: import must auto-emit events).
Each phase: implement → verify (protocol below) → steering/decision-log updates → **one commit per
phase** (plan.md's protocol: docs land "in the same commit as the feature") → worklog row.

## Verified state & drift corrections (explored 2026-07-08, post-Tier-1)

Infrastructure already in place (don't rebuild):
- **Cron (CC-1) done:** `wrangler.jsonc` has both triggers (top-level + env.preview);
  `src/main.tsx:111-114` exports `{fetch, scheduled}`; `src/jobs/index.ts` dispatches on the
  literal cron string — `PER_MINUTE` list is **empty and waiting** for the publish drain
  (jobs/index.ts:21-23); `DAILY_MAINTENANCE` has `purgeExpiredTrash` and comments reserving slots
  for events-prune + snapshot hook.
- **CC-4 done:** `collectionsWithAction(db, principal, action) → '*' | string[]` at
  `src/services/access/index.ts:60-77` (header comment already names the events feed as consumer).
- **CC-5 half done:** `MAX_MCP_BODY_BYTES = 8 MiB` and `assertBodyWithinLimit(c, max?)` exist in
  `src/lib/api.ts`; **`MAX_IMPORT_BODY_BYTES = 10 MiB` still to add** (Phase 8).
- `consumeRateLimit(kv, name, tier, clientId)` exported from `src/middleware/rate-limit.ts:65-89`.
- Migrations: highest is `0009`; journal consistent. **Tier 2 migrations start at `0010`.**

Drift corrections vs plan.md's Phase 5–8 text:
1. **`src/lib/def-helpers.ts` does NOT exist** (Phase 1 RE-PLAN reused `pickTitleField` instead).
   Phase 6 creates it: `titleFieldOf` = export/move of the existing `pickTitleField` heuristic
   (`src/services/documents/index.ts:238-241` — first `text`/`slug` field), NOT the
   showInList-based `displayTitleField` in `document-view.tsx` (two divergent heuristics exist;
   pick `pickTitleField` for feeds/OG — it's what the search index already uses).
2. **No excerpt helper exists.** `buildSearchText(def, data) → {title, body} | null`
   (services/documents/index.ts:165-194) is the extraction seam; the per-field markdown/html
   strippers are private `toSearchText` impls. Phase 6: feed/OG assembly happens in a service
   using `buildSearchText`; `src/lib/feeds.ts` stays pure (pre-extracted strings → XML).
3. **No head-props seam exists:** zero `ContextRenderer` augmentation, all 38 `c.render()` calls
   single-arg, RootLayout destructures only `children` (`src/layouts.tsx:18`). CC-3 is genuinely
   net-new in Phase 6 (as planned).
4. **`createDocument` has no explicit-id path** — id minted internally via `newId('document')`
   (documents/index.ts:709; prefix is `doc_`). Phase 8 extends the service input with optional
   `id` (validated `/^doc_[A-Za-z0-9_-]+$/`) exactly as plan.md specifies.
5. **`'system'` actor is unblocked:** `audit_log.principal_id` is plain TEXT, **no FK, no CHECK on
   `surface`** (schema.ts:25-45, migration 0000 verified) — system audit rows need no migration.
   `principals.kind` CHECK ('user','agent') is irrelevant (system has no row). `seed.test.ts`
   guards only role-permission drift — unaffected.
6. **Static MCP tool template = `upload_media`** (`src/mcp/tools.ts:395-427`), not `list_audit`
   (which is co-gated with `list_teams` in one `manage_access` block, :137-178). `McpToolContext`
   (:43-46) = `{media?, consumeUploadLimit?}` only — `poll_events` needs just the existing `db`
   param, no ctx change.
7. **Keyset/REST templates:** events query = clone of `listAuditPage`
   (`src/db/queries/audit.ts:62-83`, N+1 fetch, (createdAt,id) cursor — adapt to plain
   `seq > since` which is simpler); REST route = `src/routes/api/audit/index.tsx` pattern
   (`apiPrincipal(c, now)` in-handler, `apiJson`).
8. **Batch append points for events (Phase 7):** insert/update batches at
   `src/db/queries/documents.ts:432-460 / 478-506` (plain `BatchItem[]` arrays — append-friendly);
   trash batches at `trash.ts:86-108 / 197-247`; media insert/delete are **single statements**
   (media.ts:41-59, 121-123) → wrap in 2-item batches; `deleteCollectionRow` is **already a
   batch** (collections.ts:87-98) → append; collection insert/update single → wrap.
9. **Drive-by fix (Phase 5, file already touched):** EditorSidebar delete-dialog copy still says
   "permanently removes … cannot be undone" (editor-sidebar.tsx:164) — stale since trash landed.
   Change to "moves to trash; recoverable for 30 days".
10. Settings field names for Phase 6: `siteName`, `siteDescription`, `siteUrl` (not
    `description`/`url`). `resolveBaseUrl(c.env, settings, c.req.url)` precedence:
    BASE_URL → siteUrl → request origin.

---

## Phase 5 — Scheduled publishing (D30, D32)

Full spec: plan.md "Phase 5". Summary + adaptations:

- **Migration `0010`** (drizzle + hand-added partial index): `documents.publish_at` TEXT nullable;
  `CREATE INDEX documents_publish_at ON documents(publish_at) WHERE publish_at IS NOT NULL`.
- **CC-2 system actor:** add `'system'` to `Surface` + `Principal.kind`
  (`src/access/types.ts:27,34`); `systemPrincipal()` factory next to `anonymousPrincipal`
  (`src/access/authorize.ts:43-45`); one branch in `authorize()` — `kind === 'system'` skips
  permission resolution, still calls `appendAudit` (allowed=1), mints Grant.
- **Service:** `scheduleDocument(db, principal, collection, id, publishAt|null, now)` — requires
  `publish` action + `hasLifecycle(def)`; published doc → 400; null = cancel.
- **Drain:** `src/jobs/publish.ts` — witness-free due-doc selection
  (`status='draft' AND publish_at <= now` LIMIT 50) then per-doc
  `setPublished(db, systemPrincipal(), …, true, now)` (setPublished at documents/index.ts:836-879
  also clears `publish_at` in the same update — extend `UpdateInput`/`toDomain` for the new
  column). Register in the empty `PER_MINUTE` list.
- **UI:** EditorSidebar publish section gains `datetime-local` input (reuse
  `datetimeLocalToIso`/`isoToDatetimeLocal` from `src/fields/datetime.tsx:25,35`) + Schedule/Cancel
  → native POST `/admin/c/:collection/:id/schedule`; pending state shows "Scheduled for {date}".
  Include drift fix #9 (delete-dialog copy).
- **REST:** `POST /api/c/:collection/:id/schedule` `{publishAt: string|null}` (per-collection
  OpenAPI generator). **MCP:** generated `schedule_<slug>` `{id, publish_at?, cancel?}` (exactly
  one required), gated `couldDo(publish)`, offered only when `hasLifecycle` — slot into the
  per-collection loop next to `publish_<slug>` (tools.ts:319-326).
- Surface `publishAt` in document payloads (toDomain + REST/MCP outputs).

Files: new `src/jobs/publish.ts`, `src/routes/admin/c/[collection]/[id]/schedule.tsx`,
`src/routes/api/c/[collection]/[id]/schedule.tsx`, migration 0010. Modified: access/types.ts,
access/authorize.ts, db/schema.ts, db/queries/documents.ts, services/documents/index.ts,
components/admin/editor-sidebar.tsx, mcp/tools.ts, jobs/index.ts, lib/openapi.ts.

Verify (unit): schedule validation (published→400, deny audited); drain publishes due drafts with
`surface:'system'` audit rows + clears publish_at; skips future; cancel clears. E2E: new
`e2e/scheduled-publish.spec.ts` (schedule in sidebar → pending visible → cancel). Manual: drain
via unit harness. Steering: ACCESS_CONTROL (system actor), API_AND_MCP_STANDARDS,
DATABASE_STANDARDS (partial index). Log D30 + D32.

## Phase 6 — Public discovery: feeds, sitemap, OG, `/` index (D35, D36)

Full spec: plan.md "Phase 6". Summary + adaptations:

- **CC-3 head threading:** `PageHead` type; augment Hono `ContextRenderer` so
  `c.render(content, head)` typechecks; RootLayout (`src/layouts.tsx:18-36`) reads
  `{title, description, canonical, ogType, ogImage, feedUrl}` with current static text as
  fallbacks. Existing single-arg `c.render` calls unchanged.
- **`src/lib/def-helpers.ts` (NEW, drift #1/#2):** `titleFieldOf` (move/re-export
  `pickTitleField`), `excerptOf(def, data)` (via `buildSearchText` body → whitespace-collapse →
  160 chars — assemble in the service layer if lib→fields layering forbids direct field access;
  check CODING_CONVENTIONS), `publicUrlOf(def, doc, baseUrl)` (slug-field value else
  `/{collection}/{doc.id}` — public route accepts ids, verified).
- **`src/lib/feeds.ts` (NEW):** pure XML builders (RSS 2.0 merged feed limit 50, `?collection=`
  narrows w/ 404 if not publicRead; sitemap cap 5000; robots). All values XML-escaped. Always-on.
- **Routes:** hand-register `/rss.xml`, `/sitemap.xml`, `/robots.txt` in `src/main.tsx` next to
  the openapi.json precedent (:87-90). Handlers use `anonymousPrincipal('rest')` — public CSP
  applies automatically (security-headers.ts:65-72, verified).
- **Doc page head:** `[collection]/[slug]/index.tsx` sets title/description/canonical/
  ogType:'article'/ogImage (first media field → `/media/<id>`)/feedUrl. (No head on the
  `rawPageHtml` short-circuit — it bypasses the layout by design.)
- **`/` index:** if no publicRead collections → keep redirect; else PublicShell homepage
  (masthead + per-collection recent published docs). PublicShell needs a list variant (verified:
  none exists today).

Files: new `src/lib/feeds.ts`, `src/lib/def-helpers.ts`. Modified: layouts.tsx (+augmentation),
main.tsx, routes/index.tsx, routes/[collection]/[slug]/index.tsx, services/documents (export
pickTitleField), components/layouts/public-shell.tsx.

Verify (unit): XML escaping; drafts/non-publicRead/lifecycle-none excluded; publicUrlOf fallback;
robots content. E2E: new `e2e/public-discovery.spec.ts` (rss/sitemap contain seeded published doc;
og:title + canonical on doc page; **anonymous never sees a draft**). Manual:
`curl -s 127.0.0.1:3100/rss.xml | head`. Steering: SECURITY_STANDARDS (3 intentional public
routes). Log D35 + D36.

## Phase 7 — Events outbox (D33)

Full spec: plan.md "Phase 7". Summary + adaptations:

- **Migration `0011`** (`events` in schema.ts): `seq` INTEGER PK **AUTOINCREMENT** (documented
  nanoid-PK exception), `type`, `collection`, `resource`, `principalId`, `createdAt`; index
  createdAt. Pointers only, no payload.
- **Write mechanics:** services build `EventInput`; query mutation inputs gain optional
  `event?: EventInput`; queries append `db.insert(events).values(…)` to existing batches per
  drift #8 (documents insert/update, trash/restore, media wrap-in-batch, collections wrap/append).
  Scheduled publishes flow through `setPublished` → instrumented free.
- **Read:** `GET /api/events?since=&collection=&limit=` (clamp 100/500) — `seq > since`, readable
  set via `collectionsWithAction(…, 'read')` (`'*'` → no predicate), ORDER BY seq ASC, response
  `{data, nextSince}`; gaps legal (pruned horizon — document). Template: api/audit route.
  OpenAPI static path (`src/lib/openapi.ts` staticPaths :86-140).
- **MCP:** static `poll_events {since?, collection?, limit?}` — mirror the `upload_media` template
  (drift #6), offered to all token principals, same permission-filtered service.
- **Retention:** `EVENTS_RETENTION_DAYS = 30` in `src/config/retention.ts`; `pruneEvents`
  witness-free query + job in `DAILY_MAINTENANCE` (comment slot already reserved).

Files: new `src/db/queries/events.ts`, `src/services/events/index.ts`,
`src/routes/api/events/index.tsx`, migration 0011. Modified: schema.ts, queries
documents/trash/media/collections, services documents/trash/media/collections, mcp/tools.ts,
jobs/index.ts, config/retention.ts, lib/openapi.ts.

Verify (unit): every mutation type emits exactly one in-batch event (create/update/trash/restore/
publish/unpublish/media/collection); seq monotonic; since-cursor exact; per-collection filtering
incl. wildcard + publicRead + tokenScope; prune. Manual: mutate via MCP →
`curl '/api/events?since=0'` with scoped token → only that collection's events. Steering:
DATABASE_STANDARDS (AUTOINCREMENT exception, outbox-in-batch), API_AND_MCP_STANDARDS. Log D33.

## Phase 8 — Import/export + snapshot (D37)

Full spec: plan.md "Phase 8". Summary + adaptations:

- **Format:** NDJSON; line 1 header `{kind:'remill-export', version:1, exportedAt, collection:
  <full def>}`, then document lines. `src/lib/ndjson.ts` serialize/parse-with-line-numbers.
- **Export:** `exportCollection(db, principal, slug)` — authorize read + `compileReadFilter`,
  cursor-loop 200/page; you export what you can read. REST `GET /api/c/:collection/export`
  (`application/x-ndjson`, OpenAPI static); admin Export button in the PageHeader `actions` slot
  (`routes/admin/c/[collection]/index.tsx:39-44`) → `GET /admin/c/:collection/export`
  (Content-Disposition attachment).
- **Import:** `POST /api/c/:collection/import` (add `MAX_IMPORT_BODY_BYTES = 10 MiB` — CC-5
  remainder, drift: not yet present) + admin page `/admin/c/:collection/import` (classic form).
  Upsert by id: exists → `updateDocument`; else `createDocument` **with new optional preserved-id
  input** (drift #4). Full validated pipeline + per-item authorize per line; header def slug must
  match target → 400; `?dryRun=1`; response `{created, updated, failed, errors:[{line,id?,error}]}`.
  New rate bucket `'import'` 10/60s (tiers at rate-limit.ts:31-34).
- **Snapshot:** `snapshotSite(db, r2, now)` admin-gated: all defs + ALL docs + settings → R2
  `snapshots/<ISO>/<slug>.ndjson` + `manifest.json` (note: media binaries excluded). Reuses MEDIA
  binding (only `media/` prefix exists today — verified no collision). Button on `/admin/settings`
  — clone the rebuild-search pattern (`routes/admin/settings/index.tsx:57-77` +
  `rebuild-search.tsx` with `requireRole('admin')`). Cron snapshot NOT wired (comment hook only).
- Import auto-emits events via the Phase 7 instrumentation (nothing extra to do — the dependency
  is just ordering).

Files: new `src/lib/ndjson.ts`, `src/services/transfer/index.ts`,
`src/routes/api/c/[collection]/export.tsx` + `import.tsx`,
`src/routes/admin/c/[collection]/import.tsx` + export handler. Modified: services/documents
(optional preserved id), routes/admin/c/[collection]/index.tsx, routes/admin/settings/index.tsx,
lib/api.ts, middleware/rate-limit.ts, lib/openapi.ts.

Verify (unit): export respects compiled read filter; round-trip preserves ids/status/timestamps;
upsert updates; per-line errors + dryRun writes nothing; def-slug mismatch 400; bad id rejected.
E2E: new `e2e/import-export.spec.ts` (+ axe on import page). Manual: Snapshot button →
`wrangler r2 object list` locally. Steering: API_AND_MCP_STANDARDS (NDJSON spec),
SECURITY_STANDARDS (import bucket + body limit). Log D37.

---

## Verification protocol (every phase — plan.md verbatim)

1. `bun run type-check && bun run lint && bun run test:run` green.
2. `bun run routes` after new route files; `bun run db:generate`/`db:migrate` after migrations.
3. Kill :3100 + `rm -rf .wrangler/state/v3/d1` before e2e; `bun run build && bun run e2e` green —
   **every new admin page (import page) added to the axe sweep in `e2e/admin-smoke.spec.ts`**.
4. Exercise end-to-end on the dev server: each phase's Manual checks above.
5. Same-commit closeout: decision-log rows (D30/D32/D33/D35/D36/D37) + steering docs (matrix in
   plan.md) + worklog row per phase.

E2E gotchas (from Tier 1): per-spec unique `CF-Connecting-IP`; per-run unique names
(`Date.now().toString(36)`); import from the e2e fixtures module, never `@playwright/test`;
`FormField` appends " (required)" — anchored regex.

## After Phase 8

Update plan.md status header + Revision Log (Tier 2 done), root CLAUDE.md build-status paragraph.
Tier 3 (Phases 9–11) remains. Standing item: rotate the Resend API key (not part of this plan).
