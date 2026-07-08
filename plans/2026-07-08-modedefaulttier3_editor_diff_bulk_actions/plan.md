# Tier 3 Execution Plan — Phases 9–11 (editor islands, revision diff, bulk actions)

**Status: COMPLETE — 2026-07-08** (execution overlay of the tiered roadmap; all three phases
shipped as per-phase commits e2b6c4d/da546d9/3293759 + close-out 4e2eb82. The canonical record —
final state, RE-PLANs, and step log — lives in
`plans/2026-07-07-platform_completion_tiered_roadmap/{plan,worklog}.md`.)

## Context

Tiers 1–2 (Phases 1–8) of `plans/2026-07-07-platform_completion_tiered_roadmap/plan.md` are
committed per-phase on `feature/platform-completion-tier1` (through `78e5e22`, tree clean; 323
unit / 53 e2e green). The user asked to plan Tier 3 — the final tier: Phase 9 (CodeMirror
markdown island + media-picker island — implements D13, supersedes D12), Phase 10 (revision diff
viewer), Phase 11 (bulk actions on admin lists, D39). **plan.md remains the authoritative
design** (decisions marked do-not-reopen); this file is the execution overlay with
verified-against-code corrections. Where they disagree on design, plan.md wins — EXCEPT the
`@get` fragment-loading correction below, where plan.md contradicts the repo's own steering.

**Execution order: 9 → 10 → 11** (no inter-phase deps; numeric order). Each phase: implement →
verify → steering/decision-log updates → one commit → worklog row in
`plans/2026-07-07-platform_completion_tiered_roadmap/worklog.md`. After Phase 11: finish the
roadmap — plan.md status → COMPLETE, root CLAUDE.md build state, memory; offer `/wrap-up`.

## Verified state & drift corrections (explored 2026-07-08, post-Tier-2)

1. **The widget contract prop is `EditComponent`**, receiving `{field, config, value, signal}`
   (`src/fields/types.ts:90-96, 177`) — there is NO `id` prop; the control id IS the signal
   (`controlProps` in `src/components/admin/field-shell.tsx:61-79` emits
   `{id: signal, name: field.key, 'data-bind': signal}`). `signal = field.key`
   (`generated.tsx:26`). The markdown island wrapper adapts: carry the label TEXT (or give the
   FormField label an id) rather than plan.md's assumed `data-label-id` plumbing.
2. **Datastar `@get` fragment-loading is BANNED here** — plan.md's "dialog body loads a fragment
   via `@get('/admin/media/picker')`" contradicts `src/lib/datastar-response.ts:12-13` and
   DATASTAR_PATTERNS §g ("do NOT use @get [for load fragments]… use a client lazy-fetch
   island"). Correction: the media-picker island itself does a **plain `fetch` + `innerHTML`**
   of the server-rendered fragment when the dialog opens (user gesture); Datastar's
   MutationObserver wires any injected `data-*`. RE-PLAN note when closing the phase.
3. **`<Script>` discovery**: vite config whitelists `src/layouts.tsx` + `src/routes/**`
   (`vite.config.ts:10`). Island Scripts go in the two editor ROUTE files
   (`src/routes/admin/c/[collection]/[id]/index.tsx` + `new.tsx` — neither has a Script today;
   both compose `GeneratedForm id="editor-form" renderActions={false}` + `EditorSidebar`).
4. **Existing admin upload route returns a 303** (`src/routes/admin/media/upload.tsx:27`), not
   JSON — so the picker keeps plan.md's dedicated co-located endpoint (below) for the in-dialog
   upload, returning JSON `{id}` so the island can select-and-refresh.
5. **Media field value = ONE `med_…` id string** (`src/fields/media.tsx:21-25`); current widget
   is thumbnail + plain Input (data-bind via controlProps) + "Media library ↗" link. The picker
   writes the id into that input + dispatches bubbling `input` (§g handoff — the input STAYS).
6. **Theme**: tokens are CSS custom properties with `light-dark()` values
   (`src/tailwind.css` — `--color-ink/surface/surface-raised/border/border-strong/accent/ring`);
   dark mode = `data-theme` on `<html>` driving `color-scheme`. The CodeMirror theme should
   reference `var(--color-*)` directly — no light/dark branching needed. `.rm-prose` is the
   token-mapping precedent.
7. **Dialog API** (`src/components/ui/dialog.tsx`): `{id, title, description?, footer?, size}`,
   opened via `getElementById(id).showModal()`; content slot scrolls within 85vh. Delete dialog
   in editor-sidebar.tsx:190-213 is the live precedent.
8. **`listRevisions` service returns `{id, revision, data, savedBy, savedAt}` newest-first**
   (service `documents/index.ts:686`; query `queries/documents.ts:578-595`) — the diff route
   calls it directly (the sidebar's local `Revision` type is narrower; don't reuse it).
9. **GeneratedTable** (`generated.tsx:101-166`): columns = `showInList` fields (fallback first
   field), status badge when `hasLifecycle`, first column is the row link, `FieldCell` fallback
   `String(value)`. Confirmed NO selection mechanism. EmptyState branch at :116-124 — bulk UI
   only when `rows.length > 0`.
10. **Bulk gate is `hasLifecycle(def)`** (what `setPublished` enforces), NOT
    `workflow?.draftPublish` (the sidebar's stricter button gate). Signatures verified:
    `setPublished(db, principal, slug, id, publish: boolean, now)`,
    `deleteDocument(db, principal, slug, id, now)` — both audit + emit events per item.
11. **Flash banner, not Toast**: the repo's result-message precedent is a `role="status"` `<p>`
    driven by query params (`trash/index.tsx:62-87` `?restored/?destroyed/?error`;
    `settings ?rebuilt`). Use `?bulk=ok:<n>,failed:<m>` → flash banner on the list page (the
    Toast component is reserved for the global `app-error` host). Minor deviation from plan.md's
    "→ Toast" wording.
12. **Multi-value form parsing**: `c.req.parseBody({all: true})` + the `asArray` helper pattern
    (`share.tsx:19-22` precedent); repeated `name="ids"` checkboxes arrive as `string[]`.
13. **No `data-on:change` precedent in the repo** (only `data-on:click` one-liners). Load the
    **datastar skill before writing the select-all checkbox** — verify v1 event-attribute syntax
    rather than guessing.
14. **Deps absent as expected**: no codemirror/@codemirror/* in package.json. Add exactly
    `codemirror` + `@codemirror/lang-markdown` (plan.md: nothing else).
15. **e2e**: specs use `@playwright/test` + `helpers/auth` (not a fixtures module); free
    CF-Connecting-IPs: `.28`, `.29`, `.30`. Axe sweep list at `admin-smoke.spec.ts:73-84`.
    Dynamic URLs (editor page, compare page) get inline axe in their own specs
    (public-discovery precedent). Playwright `page.request` does NOT carry the session cookie —
    use in-page `fetch` for authed endpoint asserts (Tier-2 lesson).

---

## Phase 9 — Editor islands: CodeMirror + media picker (D38; implements D13, supersedes D12)

Full spec: plan.md "Phase 9", with corrections #1–#7 above.

- **Deps:** `bun add codemirror @codemirror/lang-markdown`. Vite-bundled, self-hosted, CSP-safe.
- **Markdown island** (`src/client/markdown-editor.ts`): `src/fields/markdown.tsx` wraps its
  Textarea in `<div data-md-editor>`; the Textarea (with `data-bind` from controlProps) STAYS in
  the DOM, visually `sr-only` (NOT display:none). Island: per `[data-md-editor]`, create an
  `EditorView` seeded from `textarea.value`; extensions: minimal setup (no line numbers),
  `markdown()`, a theme mapping `var(--color-*)` tokens, and accessible labelling (aria-label
  from the field label — give the wrapper `data-label="<label text>"`, or an id on the FormField
  label + `aria-labelledby`). **Sync back (§g):** updateListener →
  `textarea.value = doc.toString(); textarea.dispatchEvent(new Event('input', {bubbles: true}))`
  — the Datastar signal updates; whole-form `@post` unchanged.
- **Media picker** (`src/client/media-picker.ts`): `src/fields/media.tsx` keeps the id Input +
  thumbnail; adds a "Browse media" Button opening a `Dialog`. The island (correction #2) fetches
  `GET /admin/media/picker` (plain fetch → innerHTML into the dialog body) on open; fragment =
  thumbnail grid + "Show more" + a native file input row. New routes:
  `src/routes/admin/media/picker.tsx` (`requireAuth()`, renders the FRAGMENT only — no
  AdminShell; each tile a `<button data-media-id=…>`) and co-located
  `POST /admin/media/picker/upload` (`requireAuth()` + `rateLimit('upload', UPLOAD_RATE_LIMIT)`,
  calls `uploadMedia`, returns JSON `{id, url, alt}` — correction #4). Island duties only:
  `showModal()/close()`, fragment fetch/refresh, FormData upload POST, and on tile click writing
  the id into the field input + dispatching bubbling `input`. Wrapper carries
  `data-media-picker-for={field signal}` (the input id IS the signal — correction #1).
- **Script loading:** `<Script src="/src/client/markdown-editor.ts" />` and
  `<Script src="/src/client/media-picker.ts" />` added in BOTH editor route files (correction
  #3) — never in shared components. Islands must tolerate pages where their targets are absent.
- **Files.** New: `src/client/markdown-editor.ts`, `src/client/media-picker.ts`,
  `src/routes/admin/media/picker.tsx` (+ upload handler file or co-located POST export).
  Modified: `src/fields/markdown.tsx`, `src/fields/media.tsx`,
  `src/routes/admin/c/[collection]/[id]/index.tsx`, `src/routes/admin/c/[collection]/new.tsx`,
  `package.json`.
- **Verify.** Unit: picker fragment ACL (requireAuth; upload authorizes create on media via the
  service). E2E: new `e2e/editor-islands.spec.ts` (IP `.28`): type in CodeMirror → save → value
  persisted (proves §g sync); open picker → select tile → input value set; upload inside picker
  appears in grid + selects; axe on the editor page and picker-open state; keyboard pass
  (focus reaches the editor and dialog). Manual: dark-mode CodeMirror theme; `bun run build`
  bundle sanity (islands code-split per route).
- **Steering:** DATASTAR_PATTERNS (two worked island examples — CodeMirror sync, picker
  fetch-fragment), DESIGN_SYSTEM (editor token mapping). **Decision D38** (D13 implemented,
  D12 superseded, plus the fetch-not-@get correction).

## Phase 10 — Revision diff viewer

Full spec: plan.md "Phase 10", with corrections #8–#9.

- **Diff:** new `src/lib/diff.ts` — hand-rolled LCS line diff, no dependency (~60 lines):
  line-split, DP table capped at 5,000 lines/side (beyond → "too large to diff"), output
  `{kind: 'same'|'add'|'del', line}[]`. Thoroughly unit-tested.
- **Route:** new `GET /admin/c/[collection]/[id]/revisions?from=&to=` (requireAuth; mirror the
  editor page's fetch pattern — getCollectionOrThrow → requirePrincipal → `listRevisions`,
  which read-authorizes inside). Defaults: latest two. For each field key in the UNION of both
  revisions' data: value → string (strings verbatim; everything else
  `JSON.stringify(v, null, 2)`) → diff → per-field Cards with `<ins>`/`<del>` semantic elements
  styled with success/danger tone tokens. From/to = two `Select`s in a GET form
  (`components/ui/select.tsx`); revision labels via `formatDate(savedAt, settings)`.
- **Sidebar:** Revisions card header gains a "Compare" link →
  `/admin/c/:slug/:id/revisions` (only when ≥2 revisions). No REST change (revisions endpoint
  exists).
- **Files.** New: `src/lib/diff.ts`, `src/lib/diff.test.ts`,
  `src/routes/admin/c/[collection]/[id]/revisions.tsx`. Modified:
  `src/components/admin/editor-sidebar.tsx`.
- **Verify.** Unit: LCS correctness (adds/dels/unchanged/empty sides/cap); field-union rendering
  (field present in only one revision). E2E (fold into `e2e/editor-islands.spec.ts` or new spec,
  IP `.30`): edit a doc twice → Compare shows the changed line marked; inline axe on the compare
  page. No decision-log entry named in plan.md — none required.

## Phase 11 — Bulk actions on admin lists (D39)

Full spec: plan.md "Phase 11", with corrections #10–#13.

- **UI (classic form, no signals for the submission):** `GeneratedTable` gains optional
  `selectable` — when set (and rows exist), the list page wraps table + bulk bar in
  `<form method="post" action="/admin/c/:collection/bulk">`; leading checkbox column
  (`name="ids" value={doc.id}`, per-row `aria-label` from the title-field value — reuse
  `titleFieldOf` from `src/lib/def-helpers.ts`), header select-all checkbox (Datastar one-liner
  — verify syntax via the datastar skill, correction #13). Fixed bulk bar inside the form:
  buttons `name="op"` value `publish|unpublish|trash` (publish/unpublish only when
  `hasLifecycle(def)` — correction #10); copy notes "Trash is recoverable for 30 days" — no
  confirm dialog.
- **Endpoint:** new `POST /admin/c/[collection]/bulk` (`requireAuth`): `parseBody({all: true})`
  + `asArray(body.ids)` (correction #12), cap **100** ids → 400; validate `op`. Service
  `bulkDocuments(db, principal, slug, op, ids, now)` in `src/services/documents/index.ts` loops
  the existing `setPublished` / `deleteDocument` PER ID with per-item try/catch (the
  `drainScheduledPublishes` pattern) — per-item authorize + audit + events preserved; partial
  failure never rolls back completed items. Redirect `?bulk=ok:<n>,failed:<m>` → `role="status"`
  flash banner on the list page (trash `?restored` template — correction #11).
- **MCP/REST bulk:** out of scope (per-item tools exist).
- **Files.** New: `src/routes/admin/c/[collection]/bulk.tsx`. Modified:
  `src/components/admin/generated.tsx`, `src/routes/admin/c/[collection]/index.tsx`,
  `src/services/documents/index.ts`.
- **Verify.** Unit: `bulkDocuments` per-item authorize (mixed-permission id set → partial result,
  failures reported — author fixture); 100-cap; op validation; trash rows land in trash; events
  emitted per item. E2E: new `e2e/bulk-actions.spec.ts` (IP `.29`): select-all → trash → rows in
  /admin/trash; publish/unpublish toggles badges; checkboxes keyboard-operable; inline axe on
  the list page with the bulk bar visible. Add `/admin/c/posts` to the admin-smoke axe sweep if
  not exercised inline.
- **Steering:** DATASTAR_PATTERNS (native-form bulk pattern). **Decision D39**.

---

## Verification protocol (every phase — unchanged)

1. `bun run type-check && bun run lint && bun run test:run` green.
2. `bun run routes` after new route files (no migrations this tier — schema untouched).
3. Kill :3100 + `rm -rf .wrangler/state/v3/d1 test-results`; `bun run build && bun run e2e`
   green — new admin pages in the axe sweep or inline-axe'd.
4. Exercise end-to-end on the running preview (manual checks above; especially the dark-mode
   editor theme and a real picker upload).
5. Same-commit closeout: decision-log rows (D38 after D37; D39 after D38) + steering docs +
   worklog row per phase.

E2E gotchas (carried): per-spec unique CF-Connecting-IP; per-run unique names
(`Date.now().toString(36)`); in-page fetch for authed endpoints (never `page.request`);
serial-group retries re-run against the same D1.

## After Phase 11 — roadmap completion

Update plan.md status header → **COMPLETE (11/11)** + Revision Log entry; root CLAUDE.md
build-status paragraph (Tier 3 shipped; D12/D13 resolved — remove the "deferred CodeMirror/Uppy"
caveat in the Tech Stack section and the `src/client/init.ts` stub wording); memory update.
Standing item: rotate the Resend API key; branch still unmerged/unpushed (merge on request).
