# Admin edit page rework: one scroll, share drawer, relation picker

## Context

The admin document edit page (`/admin/c/:collection/:id`) has six problems Colin raised. I measured the
live page (`/admin/c/articles/doc_dClgPhboV0bnk8juOrlI0`, 1728px viewport) to find the root causes:

| # | Complaint | Measured root cause |
|---|-----------|---------------------|
| 1 | Dual scroll | The rail is 4,530px of content in an 817px `overflow-y-auto` box. The Share card alone is 2,829px (10 review links at ~230px each). The body editor is a third scroller (672px box, 6,448px hidden). |
| 2 | Horizontal scroll | The page is 455px too wide. The markdown island hides the source `<textarea id="body">` by adding `sr-only`, but the textarea's own `w-full` wins over `sr-only`'s `width:1px`, so it is an absolutely positioned 1728px-wide box with no positioned ancestor. |
| 3 | Poor layout | Form capped at 672px inside a 1152px column (dead space both sides), six boxed cards stacked in the rail, field rows with inconsistent widths. |
| 4 | Share links clunky | Two near-identical sections (read-only vs review), each row ~230px, creation bounces through a "Share link created" interstitial page, every action is a full reload that discards unsaved edits. |
| 5 | Relations clunky | A text box where you paste comma-separated `doc_…` ids. No titles, no search. |
| 6 | Inconsistent "Private" label | Header and Visibility card use a `Badge`; the list page uses a `Stamp`. |

Decisions confirmed with Colin: **wide drawer** for sharing, body editor **grows with the page**,
relations use **inline search + chips**.

Outcome: the page is the only scrollbar, nothing overflows sideways, the rail is short and scannable,
sharing happens in a drawer that updates in place, and relations are picked by title.

## Approach

Refinement, not redesign: keep the Overprint identity, existing `ui` primitives, and every service
and authorization path. No schema or migration changes. No new dependencies.

### 1. Kill the horizontal scroll (bug fix)
- `src/client/markdown-editor.ts`: replace `textarea.classList.add('sr-only')` with
  `textarea.className = 'sr-only'` (drops the conflicting `w-full`), and add `relative` to the
  `[data-md-editor]` wrapper in `src/fields/markdown.tsx` so the hidden carrier is anchored locally.
- Same carrier-hiding rule applies to the new relation picker (below).

### 2. One scrollbar
- `markdown-editor.ts` theme: remove `maxHeight: '42rem'` from `.cm-scroller` (keep `minHeight`).
  CodeMirror 6 virtualises against the window, so long documents stay fast.
- `src/components/admin/editor-sidebar.tsx`: drop the rail's `max-h` / `overflow-y-auto` /
  `overscroll-contain`. The rail stretches the grid row; only the **Save card** is
  `lg:sticky lg:top-20`. Everything else scrolls with the page.
- Below `lg` the rail stacks under a now-long body, so add a mobile-only sticky bottom bar with the
  Save button (`form="editor-form"` association, same as the rail button; `lg:hidden`).

### 3. Layout and presentation
- `src/routes/admin/c/[collection]/[id]/index.tsx`: grid becomes
  `lg:grid-cols-[minmax(0,1fr)_20rem]`; remove the form's `max-w-2xl` so content fills ~800px.
  Apply the same grid to `new.tsx`.
- Header meta line: status `Badge` + visibility stamp + a mono "Saved <date> · rev N".
- Rail follows the design system's "hairlines over boxes": the Save card stays a card (it is sticky
  and needs a surface); Visibility, Share, Comments, Details, Revisions become hairline-divided
  sections with the same `h2` titles (test locators by role/name keep working).
- Trim the tall cards: Comments shows the 3 newest open threads (was 8) plus "Open review ↗";
  Revisions shows the latest 5 plus an "All revisions" link to the existing revisions page.
- Field rows: media and relation rows get a full-width control with the secondary link
  ("Media library ↗", "Browse articles ↗") on its own small line, so every control shares one width.

### 4. Share drawer
New `src/components/admin/share-drawer.tsx` (replaces the rail's `SharePanel` body; reuses
`CopyField`, `Badge`, `FormField`, `Drawer` with `class="max-w-2xl"`):
- **Rail**: a `#share-summary` section — "1 read-only link · 10 review links · no direct access",
  the "already public" notice when relevant, and a `Share…` button that opens the drawer.
- **Drawer** (`<div id="share-manager">`, rendered outside `#editor-form`):
  - **One "New link" form.** A radio named `op` chooses *Read only* (`link`) or *Can comment*
    (`review_link`) — the existing handler ops, so no service change. Shared fields: label/reviewer
    name, password (show/hide), expiry. Comment-only fields (email to, group/individual) appear via
    `data-show`.
  - **One links list**, read-only and review together, ~76px per row: label, type badge, a mono
    meta line (password · expiry · mode · "2 reviewing, 1 done"), the URL with Copy, and a
    `<details>` for the rest (reviewer names, switch mode, email this link, revoke-with-confirm).
  - **People & roles** section, same grant form as today.
- **In-place updates.** Forms post with `data-on:submit="@post(…, {contentType:'form'})"`
  (DATASTAR_PATTERNS §b/§d). `share.tsx` returns a 200 fragment that morphs `#share-manager` and
  `#share-summary` by id, with a flash line ("Link created", "Sent to x@y", service validation
  errors caught as `AppError`). This removes the three interstitial pages (created / emailed /
  switch-mode confirm — the confirm becomes an inline notice in the row). A newly created link is
  highlighted at the top with its Copy button and the "send the password separately" reminder.
  Unsaved editor changes survive because the page never navigates. Non-Datastar posts keep the
  current 303 redirect.
- Extract the gated loading that `index.tsx` does today (lines 60–90) into one service function
  `getShareOverview(db, principal, def, id, {secret, baseUrl}, now)` in `src/services/access/`, used
  by both the page and the fragment response. It only composes existing services
  (`listShareLinks`, `listReviewLinks`, `listItemGrants`, `listPrincipals`, `listRoles`,
  `listTeams`, `canAuthorize`) — authorization is unchanged.
- If a single HTML response does not morph two top-level ids in this Datastar version, fall back to
  the SSE generator with two `patchElements` calls (DATASTAR_PATTERNS §f).

### 5. Relation picker
- `src/fields/types.ts`: add optional `expanded?: ExpandedReference | ExpandedReference[]` to
  `FieldEditProps`. `src/components/admin/generated.tsx`: `GeneratedForm` accepts the
  `ExpandedDocument` the route already has (`getDocument` returns `relations`) and passes
  `doc.relations?.[field.key]` — the same channel `FieldCell` already uses.
- `src/fields/relation.tsx` `EditComponent`: server-renders the current links as titled chips
  (title links to the document) plus the existing text input, which stays the form carrier with the
  same `id`/`name`/`data-bind` (unit contract in `field-shell.test.tsx` holds; no-JS still works).
- New fragment route `src/routes/admin/c/[collection]/picker.tsx` — `GET ?q=` returns a bare
  `<ul role="listbox">` of up to 8 matches (title + status badge). Uses `searchSite({q, collection})`
  when there is a query and `listDocuments` + `titleOf` for the empty state; both are already
  `authorize('read')`-gated. Modelled on `src/routes/admin/media/picker.tsx`.
- New island `src/client/relation-picker.ts` (pattern: `media-picker.ts`, DATASTAR_PATTERNS §g):
  debounced `fetch` + `innerHTML`, ARIA combobox (arrow keys, Enter, Escape,
  `aria-activedescendant`), add/remove chips, write the comma-joined ids to the carrier and dispatch
  `input`. Single-value relations use the same widget and replace on pick. `<Script>` tags go in the
  two route files (`[id]/index.tsx`, `new.tsx`), which is where Vite discovers them.

### 6. One visibility label
- New `src/components/admin/visibility-stamp.tsx` — `<VisibilityStamp visibility />` renders the
  list page's `Stamp tone="event"` (nothing for public). Used by the list (`generated.tsx`, both
  call sites), the edit header, and the private-collection Visibility section, so they cannot drift.

### Docs and tests
- e2e updates (locators move into the drawer / picker): `visibility-and-share-links.spec.ts`,
  `platform-graph-publish.spec.ts` (share flow + relation `fill` → pick by title),
  `document-review.spec.ts` (`linkUrl` helper), `admin-schema-access.spec.ts`, `teams.spec.ts`.
  Add a shared `openShare(page)` helper in `e2e/helpers/`.
- New e2e assertions on the edit page: `scrollWidth <= clientWidth` (desktop and phone), the rail is
  not a scroll container, relation pick/remove round-trips through save, create/copy/revoke a link
  without leaving the page. Axe sweep with the drawer open.
- Unit: relation `EditComponent` renders chips from `expanded`; `VisibilityStamp`.
- Steering: `DESIGN_SYSTEM.md` (editor rule becomes "sticky Save card, page is the only scroller";
  visibility exceptions are always a Stamp), `DATASTAR_PATTERNS.md` §g (add the relation picker and
  the "replace the carrier's class list" hiding rule), `docs/TECH_DECISIONS.md` (D59), and the
  CLAUDE.md build-status paragraph.

## Order of work
1. Move this plan to `plans/2026-10-04-admin_edit_page_rework/plan.md`, start
   `worklog.md`, branch `feat/editor-page-rework` from the current D57 branch (it depends on D57's
   Visibility card; no commits unless asked).
2. Steps 1, 2, 6 (small, independent) → 3 (layout) → 5 (relation picker) → 4 (share drawer).
3. Tests and docs, then verification.

## Verification
- `bun run type-check`, `bun run lint`, `bun run test:run`.
- `bun run e2e` for the specs above plus `editor-islands`, `scheduled-publish`, `trash`,
  `draft-preview`, `visibility-safe-enable` (they touch the rail).
- `bun run dev`, then one batched screenshot round at 1728px and 390px, light and dark: edit page
  top and bottom, drawer open with many links, relation dropdown open. Confirm in the browser that
  `document.documentElement.scrollWidth === clientWidth` and that the only scroll container is the
  page (and the drawer when open).
- Impeccable detector once at the end:
  `node ~/.claude/skills/impeccable/scripts/detect.mjs --json <changed UI files>`.
- Not verifiable locally: the live document with 11 links. I will seed a local document with a
  similar number of review links to check the drawer at that scale.
