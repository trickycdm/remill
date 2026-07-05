# remill — Admin UX Improvements (7 items)

## Context

Following the code-review remediation, the user flagged 7 admin UI/UX issues. Four read-only
investigators mapped each to concrete root causes and buildable fixes against the existing design
system (`steering/DESIGN_SYSTEM.md`), Datastar v1 patterns, and the Hono-JSX component library. The
work ranges from a one-line spacing fix to net-new surfaces (a user-account page). Two findings go
beyond cosmetics: the content editor scatters actions across four zones with two competing "primary"
buttons, and the Settings area is structurally thin — its three fields are **write-only** (nothing
reads them), it isn't admin-only, and there's **no user-account surface at all**.

**Decisions (this session):** full settings/account overhaul (incl. expanded + *consumed* instance
settings); **sequential, phased execution on one feature branch** (the 7 items share files —
`PageHeader`, `admin-shell`, the `ui/*` primitives, `generated.tsx` — so clean parallel worktrees
don't apply). Local-only project; deploy-time steps go in `docs/DEPLOY_CHECKLIST.md`.

**Outcome:** consistent controls, coherent navigation (breadcrumbs + a real user menu), a single clear
action hierarchy on the editor, and a proper Settings-vs-Account information architecture — all
WCAG 2.1 AA, all built on existing primitives and tokens.

---

## Shared principles

- **Fix at the primitive, not per-page.** Most items resolve in one shared component (`PageHeader`,
  `Button`, `Checkbox`, a new `control.ts`), propagating everywhere for free.
- **Reuse existing idioms.** Datastar signal + click-outside-backdrop + `__window` Escape (already in
  `admin-shell.tsx:100-147`); `INPUT_BASE` (`input.tsx:37`); `cx()`; `surface-raised`/`rm-anim-rise`
  tokens; `Dialog`/`Card`/`Badge`/`Button` primitives; `hashPassword`/`verifyPassword`
  (`lib/password.ts`); `setSessionUser` (`lib/auth.ts`).
- **No new field types, no schema migration.** Settings expansion is schema-as-data; account editing
  uses existing `users`/`principals` columns.
- **Tests move with the UI.** Items 2 and 4 relocate controls the e2e specs select by name — those
  specs must be updated in the same phase (called out below).

---

## Phase 0 — Foundations (shared primitives; build first)

1. **`control.ts` sizing source of truth** (item 7). New `src/components/ui/control.ts`:
   `export const CONTROL_H = { sm:'h-8', md:'h-10', lg:'h-11' }`. Canonical control height = `md`
   (40px). (Separate module — keep `cx.ts` a pure join helper.)
2. **Fix `Checkbox`** (item 5). `src/components/ui/checkbox.tsx:28` — the check renders **system-blue,
   not iris**, because it sets `text-accent` (CSS `color`) but native checkboxes paint from
   `accent-color`. Change to `accent-accent`; add `border` width + `bg-surface` + `disabled:opacity-50`
   + `rounded-sm`. Keep it a styled *native* checkbox (free a11y, POSTs its value).
3. **New `Toggle` (switch)** (item 5). New `src/components/ui/toggle.tsx` — native
   `<input type="checkbox" role="switch">` restyled as track+thumb (`h-6 w-11`, thumb `size-5`,
   `peer-checked:bg-accent`/`translate-x-5`, focus ring on track). Progressive-enhancement: POSTs
   normally, `data-bind` works like a checkbox; no wrapper `<label>` (reuse `FieldShell`'s `<label for>`).
4. **New `Breadcrumb`** (item 1). New `src/components/ui/breadcrumb.tsx`: `Crumb {label; href?}[]`,
   `<nav aria-label="Breadcrumb"><ol>`, `aria-current="page"` on the last crumb, `ChevronRight`
   (`icon.tsx:252`, `aria-hidden`) separators, `text-ink-muted`/`text-ink-subtle` tokens. Barrel-export
   from `ui/index.ts`.
5. **`fieldLabel()` humanize helper** (item 3 labels). New `src/lib/humanize.ts` (`humanizeKey('siteName')
   → 'Site name'`, handles camelCase + snake_case) + a shared `fieldLabel(field)` = `field.label ??
   humanizeKey(field.key)`. Replaces the duplicated `field.label ?? field.key` at `field-shell.tsx:46`
   and `generated.tsx:100-101` — fixes labels across all six surfaces and the already-seeded live DB.
6. **`PageHeader` fixes** (items 1 + 6). `src/components/ui/page-header.tsx:29` — add `mb-8` below the
   `border-b` hairline (content currently butts against it); add an optional `breadcrumb?: Crumb[]` prop
   rendered above the eyebrow. Remove the now-redundant ad-hoc `mt-8` on the three `collections/*`
   pages.

## Phase 1 — Consistency & adoption (items 7, 5, 6, 1)

- **Control sizing (item 7):** source `Button` height from `CONTROL_H` (`button.tsx:36-41`); add
  `size?: ControlSize` to `Input`/`Select` (default `md`); extend `Select` with `multiple?` so
  `fields/select.tsx:59-68` stops hand-rolling a `py-2` select. Fix the real mismatches: the 3
  `size="sm"` buttons beside `h-10` inputs on the Access page (`routes/admin/access/index.tsx:99-107,
  146-162,183-199` — simplest: make them `md`), and the media page's raw Save `<button>` + bare file
  input (`routes/admin/media/index.tsx:34-48,77-82` — use `Button`/a small `FileInput`).
- **Checkbox/Toggle adoption (item 5):** make `fields/boolean.tsx:26-41` render the fixed `Checkbox`→
  actually a `Toggle` (boolean field reads as on/off); swap collection-builder workflow/access
  (`collection-builder.tsx:354-363`) to `Toggle`; keep `Checkbox` for the Required/Indexed/Unique flag
  group (`collection-builder.tsx:246-257`) and wrap it in `<fieldset><legend>`.
- **Labels (item 3a):** wire `fieldLabel()` into `field-shell.tsx` + `generated.tsx`.
- **Breadcrumbs (item 1):** pass `breadcrumb=` from each depth-2+ page using data already in scope
  (route params + `def.name` + doc title); omit on depth-1 pages. Drop the redundant `eyebrow={def.name}`
  where a breadcrumb now carries the parent.

## Phase 2 — Admin shell user menu (item 2)

Replace the top-bar name/badge/sign-out (`admin-shell.tsx:185-206`) with a Datastar **disclosure menu**
(not a modal): add a `userMenuOpen` signal (`:100`) + extend the Escape handler (`:102`); trigger =
name + `ChevronDown` with `aria-haspopup`/`aria-expanded`/`aria-controls`; a transparent full-screen
click-outside catcher (copy the drawer backdrop at `:141`); panel = `absolute … bg-surface-raised
rm-anim-rise`, `role="menu"`, containing the existing logout `<form method=post action=/admin/logout>`
verbatim (unchanged behavior) **plus an Account link** (`/admin/account`, lands with Phase 4). A11y
baseline = disclosure (button + `aria-expanded` + Esc + real focusable items); note APG roving-tabindex
as optional. **Update `admin-smoke.spec.ts`** if it selects the sign-out control.

## Phase 3 — Content editor action hierarchy (item 4)

Consolidate all actions + metadata into a **sticky right sidebar**; the form becomes content-only.
- **New `src/components/admin/editor-sidebar.tsx`** taking `mode: 'create'|'edit'` — renders cards:
  **Actions** (Save primary → Publish/Unpublish secondary → Cancel; `#form-result` alert region),
  **Details** (status `Badge`, `createdAt`/`updatedAt`/`publishedAt`, id/slug, author — all on
  `DocumentRecord`, currently shown nowhere), **Revisions** (existing list + Restore), and an isolated
  **Delete** below a hairline. Create mode shows only the Actions card.
- **`generated.tsx` (GeneratedForm):** give the `<form>` `id="editor-form"`; make the inline Save/Cancel
  footer optional so the Save button lives in the sidebar via `<Button type="submit" form="editor-form"
  busy="$busy">` — an **associated submit fires the form's existing `@post` with zero route changes**;
  `$busy` is page-global so the spinner works cross-column.
- **Editor pages** (`c/[collection]/[id]/index.tsx`, `new.tsx`): adopt a 2-col grid
  (`lg:grid-cols-[minmax(0,1fr)_20rem]`), sticky `<aside aria-label="Document actions" lg:sticky
  lg:top-24>`, form left. Move Publish out of `PageHeader`, Delete out from under the form, Revisions
  from the ad-hoc aside — all into `EditorSidebar`. Upgrade Delete from native `confirm()` to the
  shipped `Dialog` (focus-trap + Escape). `publish.tsx`/`delete.tsx`/`restore.tsx` routes unchanged.
- **Update e2e** (`admin-content.spec.ts`, `admin-schema-access.spec.ts`): the Publish/Save/Delete/
  Restore controls move — re-point selectors (still by role/name) to the sidebar; keep the full
  lifecycle assertions.

## Phase 4 — Settings & Account overhaul (item 3, full)

**Instance settings** (`/admin/settings`, admin-only):
- **Expand** the `settings` singleton `fields_json` (`db/seed.sql:52-61`) with a curated, labeled set —
  all existing field types, schema-as-data, no migration: `siteName`, `siteDescription`,
  `defaultAuthorName` (existing, now with `label`s), plus `siteUrl` (text), `logo` (media/image),
  `timezone` (select), `dateFormat` (select), `defaultPageSize` (number). Keep infra/security bounds in
  `wrangler.jsonc`/`constants.ts` (don't make `MAX_PAGE_SIZE` editable).
- **Consume them** (they're currently write-only): add a request-cached `getSettings(db)` reader
  (generalize the singleton read already in `settings/index.tsx`); wire `siteName`/`logo` into the admin
  masthead + `<title>` (`layouts.tsx`/`admin-shell.tsx`) and the login page; `defaultAuthorName` as a
  new-document prefill; a shared `formatDate(ts, settings)` honoring `timezone`/`dateFormat`, used in the
  editor Details card and list views.
- **Admin-only:** add `requireRole('admin')` to the settings route and remove `settings` from the
  `editor` nav set (`admin-shell.tsx:69`). (Cheap path; a `manage_settings` action would need a
  closed-vocabulary decision-log entry — deferred.)

**Account settings** (`/admin/account`, any logged-in human):
- **New write queries** (no migration — columns exist): `updatePrincipalName` (`principals.name`),
  `updateUserEmail` (`users.email`, normalize + unique check), `updateUserPassword`
  (`users.passwordHash`) in `db/queries/{principals,users}.ts`.
- **New `src/services/account/index.ts`:** `updateProfile` (name/email) + `changePassword` — the latter
  **must** `verifyPassword(current, stored)` before writing, enforce a min length, and re-hash. Scope
  strictly to `getUser(c).id` (never a body-supplied principal id).
- **New route `src/routes/admin/account/index.tsx`** (`requireAuth()`): profile form (display name,
  email) + security form (current + new + confirm password), reusing the inline-error fragment pattern
  from `login/index.tsx:76-86`; `autocomplete="current-password"/"new-password"`. After a name/email
  change, `setSessionUser` to refresh the cookie so the top-bar updates. Link from the Phase-2 user menu.
  Agents (token-only) are out of scope — account is human/session principals; agent identity stays under
  `/admin/access`.
- **Known limitation to document:** the stateless encrypted cookie can't revoke other-device sessions on
  password change (post-v1).
- **New e2e** (`account.spec.ts`): login → change display name (top-bar updates) → change password →
  re-login with the new password; wrong-current-password rejected. Add the account fixture as needed.

---

## Verification

- **Per phase:** `bun run type-check` (0), `bun run lint` (0), `bun run test:run` (all green), `bun run
  build` (0, no warnings). Add unit tests for new pure logic (`humanizeKey`, `formatDate`, the account
  service's password/email rules).
- **e2e:** `bun run e2e` green after updating specs in Phases 2–4 (self-contained via
  `db:seed:e2e`). New `account.spec.ts`.
- **Live app** (`bun run dev`, 127.0.0.1:3100 — reset local D1 if needed): breadcrumbs on nested pages;
  the top line no longer touches content on every page; user-menu opens/closes (click-outside + Esc) and
  signs out; a Button and an Input sit at the same height side-by-side; the boolean toggle + fixed
  checkbox render in **iris** (not system-blue); the editor shows one primary Save in a sidebar with
  Details/Revisions/isolated-Delete, consistent between create and edit; Settings shows human labels, is
  admin-only (an `author` can't reach it), and `siteName` appears in the masthead/title; `/admin/account`
  changes name/email/password and the top-bar name updates; a11y (axe) still passes on changed pages.
- **Diff-behavior:** confirm the editor's Publish/Delete/Restore still work post-move (same routes), and
  that changing a password then logging in with the old one fails.

## Deploy notes (append to `docs/DEPLOY_CHECKLIST.md`)

- Expanding the `settings` singleton via `seed.sql` uses `INSERT OR IGNORE`, so it **won't update an
  already-seeded DB** — a remote deploy needs a one-off `UPDATE collections … fields_json` (or a
  re-seed) for the new settings fields/labels to appear. Note this as a deploy step.
- No new migration (account uses existing columns; settings are schema-as-data). Confirm at implementation.

## Execution & plan lifecycle

Sequential on a new branch `feature/admin-ux` off `main`. On approval, relocate this plan to
`plans/2026-07-05-admin-ux/plan.md` and create its `worklog.md`; log each phase. Research subagents may
be used per phase to keep context lean, but edits stay on the single branch (shared-file overlap). Verify
green at the end of every phase before starting the next.

## File map (by area)

- **Primitives (new):** `ui/control.ts`, `ui/toggle.tsx`, `ui/breadcrumb.tsx`, `lib/humanize.ts`,
  `components/admin/editor-sidebar.tsx`. **(edit):** `ui/page-header.tsx`, `ui/checkbox.tsx`,
  `ui/button.tsx`, `ui/input.tsx`, `ui/select.tsx`, `ui/index.ts`, `fields/field-shell.tsx`,
  `fields/boolean.tsx`, `fields/select.tsx`, `components/admin/generated.tsx`,
  `components/admin/collection-builder.tsx`.
- **Shell/nav:** `components/layouts/admin-shell.tsx`.
- **Editor pages:** `routes/admin/c/[collection]/[id]/index.tsx`, `.../new.tsx` (routes
  `publish`/`delete`/`restore` unchanged).
- **Settings/account (new):** `routes/admin/account/index.tsx`, `services/account/index.ts`, plus write
  queries in `db/queries/{principals,users}.ts`, a `getSettings` reader, `lib/formatDate`. **(edit):**
  `routes/admin/settings/index.tsx`, `db/seed.sql`, `layouts.tsx`/masthead, `routes/admin/login`.
- **Fixes to raw controls:** `routes/admin/access/index.tsx`, `routes/admin/media/index.tsx`.
- **Tests:** `e2e/{admin-content,admin-schema-access,admin-smoke}.spec.ts` (update), `e2e/account.spec.ts`
  (new), unit tests for humanize/formatDate/account service.
