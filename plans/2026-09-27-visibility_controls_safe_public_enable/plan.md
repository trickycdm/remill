# Visibility you can see and change on every document (D57)

## Context

The Luupdin weekly founders report (`luupdin-reports/doc_u6xXQxGX0wW5hGIWaS70f`) looks public in the
admin but isn't: anonymous requests 404/403. Three problems caused the confusion:

1. **Misleading labels.** The editor shows only a green "Published" badge. That badge is lifecycle
   status (draft vs published), not audience. The collection has no `access.publicRead`, so nothing in
   it has a public URL, but the UI never says so.
2. **No control.** The per-document Visibility card (D50) and `visibility_<slug>` MCP tool render only
   when the collection is `publicRead` (`src/components/admin/editor-sidebar.tsx:217`,
   `src/mcp/tools.ts:716`). On any other collection there is nothing to click.
3. **Latent exposure hazard (found while planning).** `documents.visibility` defaults to `'public'`
   (`src/db/schema.ts:159`, migration 0015), and `updateCollection`
   (`src/services/collections/index.ts:350`) flips `publicRead` with no backfill or warning. Turning
   public pages on for Luupdin Reports today would instantly publish every founders report to the
   open web, RSS, sitemap and search.

**Outcome (user chose "safe enable"):** every document shows its _effective_ visibility and a
Public / Unlisted / Private control. On a collection without public pages it reads **Private
(locked)**, with an **Enable public pages** action. That action turns the collection's pages on and
switches every _other_ published document to Private in the same atomic batch, so only the chosen
document goes live. The collection builder, REST and MCP get the same guard.

## Approach

### 1. Effective visibility, one helper

`src/lib/visibility.ts`: add `effectiveVisibility(def, doc): Visibility`. It returns `'private'` when
`def.access?.publicRead !== true`, else `doc.visibility ?? 'public'`. It sits next to
`isAnonymouslyReadable` / `isListed` (re-exported via `src/lib/def-helpers.ts`), and every label
below reads from it, so stored-but-inert `'public'` values never show up in the UI.

### 2. Safe-enable service (the one place `publicRead` turns on)

`src/services/collections/index.ts`:

- `enablePublicPages(db, principal, slug, opts, now)`. `opts` is
  `{ existing: 'private' | 'keep', except?: { id, visibility } }`.
  - `authorize('manage_schema')`. When `except` is given, also `authorize('publish')` on that document
    (the same gates `updateCollection` and `setVisibility` use today).
  - Rejects `private` collections (D46 mutually exclusive): clear `access.private` → set
    `publicRead: true`. Only reachable from a non-public collection; no-op/`ConflictError` if already
    public.
  - Hands off to one query batch (below).
- `updateCollection` guard. If the input turns `publicRead` on (old false → new true), it counts
  published documents whose visibility isn't `'private'`. If there are any and no
  `onEnablePublic: 'private' | 'keep'` option was passed, it throws `ConflictError` ("N published
  documents would become public; pass onEnablePublic"). With the option, it routes through the same
  batch. Silent exposure becomes impossible from every surface.

`src/db/queries/collections.ts`:

- `enablePublicReadBatch(db, { slug, def, existing, except, now, events }, grant)`: a single
  `db.batch`:
  1. Update the collection row.
  2. `UPDATE documents SET visibility='private' WHERE collection=? AND visibility<>'private' AND
id<>?` (only when `existing==='private'`).
  3. Set the `except` document's visibility.
  4. Events: `collection.updated` plus one `document.visibility_changed` per document actually changed.
     Select the ids first, D33 outbox via `eventInsert`, the same shape `setDocumentVisibility` emits.

  Like `setDocumentVisibility`, it does not bump `updatedAt`.

- `countExposableDocuments(db, slug)`: returns the count for the guard and the UI copy.

### 3. Editor: always-present Visibility card

`src/components/admin/editor-sidebar.tsx`: drop the `publicRead` gate on the card.

- **Public collection:** unchanged (radios + Apply).
- **Non-public collection:**
  - It shows a locked state: a "Private" `Stamp` and this copy: _"{Collection} has no public pages.
    Only people with access, or a share link, can read this."_
  - With `manage_schema`: Public / Unlisted radios (Private preselected) plus a secondary button
    **Enable public pages & apply**. Help text: _"Turns on public pages for {Collection}. The other
    {N} published documents will be set to Private first."_ N comes from `countExposableDocuments`,
    loaded in the route. The button is disabled while Private is selected (the existing
    `data-attr:disabled` pattern).
  - Without `manage_schema`: _"Ask an admin to enable public pages for this collection."_
- Pass `canManageSchema` + `exposableCount` from `src/routes/admin/c/[collection]/[id]/index.tsx`
  (use `canAuthorize`, as other capability checks do).

`src/routes/admin/c/[collection]/[id]/visibility.tsx`: when the collection isn't `publicRead` and the
value isn't `private`, call `enablePublicPages(..., { existing: 'private', except: { id, visibility }
})`. Otherwise call `setVisibility` as today. The route stays thin, with no new route file.

### 4. Clear labelling

- **Edit page header** (`[id]/index.tsx:135-146`): the audience badge renders from
  `effectiveVisibility`, always shown when not `public`. Luupdin reports read **Published · Private**.
  The header link stays "View" (no public URL).
- **Share panel:** unchanged logic (`isAnonymouslyReadable` is already correct); the private copy now
  matches the card.
- **List view** (`src/components/admin/generated.tsx:127-200`): stamps use `effectiveVisibility`. For
  non-public collections, show one line under the list header ("Private collection: no public pages")
  rather than a "private" stamp on every row.
- **Collection builder** (`src/components/admin/collection-builder.tsx:532`): when the Visibility
  select moves to Public on a collection that wasn't public and has exposable documents, a Datastar
  `data-show` reveals a required radio: **Keep existing documents private (recommended)** / **Publish
  all N existing documents**. It posts `on_enable_public`. The builder route passes it through to
  `updateCollection`.

### 5. REST + MCP parity

- `update_collection` (MCP, `src/mcp/tools.ts:252`) and `PUT /api/collections/:slug` accept
  `onEnablePublic`. The `ConflictError` message names the argument so agents self-correct.
- `visibility_<slug>` stays gated on `publicRead`. On a non-public collection an agent enables
  pages via `update_collection` (explicit schema action, `manage_schema`), which is the right altitude
  for agents.
- REST `setVisibility` on a non-public collection is unchanged (stores the value, inert until
  enabled). This is noted in the docs.

### 6. Docs

- `docs/TECH_DECISIONS.md`: **D57**. Effective visibility, the safe-enable guard, and why it isn't a
  per-document-only model.
- `steering/ACCESS_CONTROL.md` §visibility: the enable guard is now an invariant ("`publicRead` never
  turns on without an explicit choice about existing documents").
- CLAUDE.md status line.
- Plan folder: `plans/2026-09-27-visibility_controls_safe_public_enable/` (`plan.md` + `worklog.md`)
  per the plan lifecycle.

## Critical files

`src/lib/visibility.ts` · `src/services/collections/index.ts` · `src/db/queries/collections.ts` (or
`documents.ts`) · `src/components/admin/editor-sidebar.tsx` ·
`src/routes/admin/c/[collection]/[id]/{index,visibility}.tsx` · `src/components/admin/generated.tsx` ·
`src/components/admin/collection-builder.tsx` + builder route · `src/mcp/tools.ts` ·
`src/routes/api/collections/[slug].tsx`

## Verification

- **Unit** (`bun run test:run`):
  - `effectiveVisibility` cases.
  - `updateCollection` throws when enabling with exposable documents and no choice.
  - `onEnablePublic:'private'` leaves all documents private except none.
  - `enablePublicPages` with `except` exposes only that document (the anonymous `authorize` read
    passes for it and fails for a sibling).
  - Events emitted once per changed document.
  - Grant gates: a publisher without `manage_schema` is refused.
  - MCP `update_collection` parity.
- **E2E**: extend `e2e/visibility-and-share-links.spec.ts`. Create a non-public collection with two
  published documents, then check:
  - The editor shows "Private" locked.
  - Enable public pages & apply as Public on one.
  - Anonymous gets 200 on it and 404 on the sibling.
  - The collection index/RSS lists only it.
  - The builder shows the confirm radio.
  - An axe pass on the new card.
- `bun run type-check && bun run lint`.
- **Live (after deploy):** open the founders report and confirm it reads **Published · Private** with
  the locked control. Do **not** enable public pages on Luupdin Reports; it should stay private.
