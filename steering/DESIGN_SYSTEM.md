# Design System

> **STATUS: IMPLEMENTED (Phase 1).** Tokens live in `src/tailwind.css`; the owned
> component library lives in `src/components/ui/` (+ `layouts/admin-shell.tsx`,
> `auth-shell.tsx`). This doc explains direction, intent, and usage — it never
> restates hex values or numeric tokens. Every generated admin surface (field
> editors, list cells, tables) composes these primitives, so the design is
> enforced at the primitive level and inherited for free.

## The locked direction — "Ink & Paper"

remill is a **refined editorial typesetting workbench**, not a dashboard. It is a
tool people write and publish in all day, so the personality is calm, legible, and
precise — memorable through restraint, not decoration. The signatures:

- **Warm paper, warm ink.** Neutrals are warm (paper/espresso), never cold grey —
  the one thing that separates remill from generic admin chrome. Light is ink on
  paper; dark is a warm "reading lamp", not black.
- **A serif masthead.** Page titles, card titles, and the `remill` wordmark are set
  in a system book-serif — the editorial voice. Body/UI is a clean system sans.
  Eyebrows, metadata, IDs, and timestamps are mono-caps — the "content tool" tell.
- **One quiet accent: iris ink.** A muted blue-violet, like fountain-pen ink,
  deliberately distinct in hue from all four status colours so "brand" never reads
  as "status". Used sparingly in the admin: primary actions, active nav, focus,
  selection. The **marketing homepage** is the one surface that uses it as a
  full-bleed colour field (the hero band) — see Contrast for the rules that keep it AA.
- **Hairlines over boxes.** Structure comes from generous whitespace and 1px rules,
  not heavy shadows or fills. Radii are restrained; motion is subtle and always
  reduced-motion-safe.

**Light and dark from day one.** Every colour token carries both values in a single
`light-dark()` declaration (see Theming). Both themes are AA-verified.

## Tokens are canonical in `tailwind.css`

Design tokens (colour, type, spacing, radii, shadows — light **and** dark) are
defined once in `src/tailwind.css` via Tailwind v4 CSS-first `@theme`. Components
consume them only through utilities (`bg-surface`, `text-ink`, `text-danger`) —
never raw hex. Need a colour? Reference the token name below.

### Colour token inventory (values in `tailwind.css`)

| Token | Intent |
|---|---|
| `canvas` | App background (behind panels) |
| `surface` / `surface-raised` | Cards, bars / elevated (dialog, drawer, popover, toast) |
| `hover` | Subtle hover / pressed fill |
| `ink` / `ink-muted` / `ink-subtle` | Primary / secondary / tertiary + placeholder text |
| `border` / `border-strong` | Hairline rules / input & divider edges |
| `accent` / `accent-hover` / `accent-fg` | Iris fill / fill hover / text on an accent fill (white) |
| `accent-text` | Accent as link/label text on a surface (AA both themes) |
| `accent-soft` | Tinted wash: active nav, selection |
| `ring` / `overlay` | Focus ring / modal backdrop |
| `success` `warning` `danger` `info` | Status **text** tone (AA on surface and on the matching `-soft`) |
| `success-soft` … `info-soft` | Status background washes (badges, toasts, notices) |
| `danger-solid` | Destructive button fill (AA white text, both themes) |

**Contrast:** every text/background pairing meets WCAG 2.1 AA in both themes; base
status tokens are text-safe, solids (`accent`, `danger-solid`) are tuned for AA
white text. Non-obvious ratios are noted inline in `tailwind.css`.

**Contrast on tinted / accent-fill backgrounds.** The AA guarantee above is tuned for
text on `canvas`/`surface`. On a **tinted `-soft` wash** (`accent-soft`, the semantic
`-soft`s), `text-ink-subtle` drops below 4.5:1 in dark mode — it is AA only on
canvas/surface, so use `text-ink-muted` for meta text on tinted bands. On a **solid
`accent` fill**, all text is `accent-fg` (white); build hierarchy with size/weight,
never opacity, so nothing dips below AA. The accent-fill `Button` is invisible there —
invert the primary CTA to a paper button (`bg-surface-raised` + `text-accent-text`) and
force the focus ring white (`focus-visible:outline-accent-fg`), since the default iris
ring vanishes on iris. Always axe any accent surface in **both** themes.

### Theming mechanism

`color-scheme` + `light-dark()`, not per-token class flipping:
`:root` is `color-scheme: light dark` (follows `prefers-color-scheme`);
`[data-theme="dark"|"light"]` forces a scheme. The admin-shell toggle sets
`data-theme` on `<html>` and persists to `localStorage['remill-theme']`;
`THEME_INIT_SNIPPET` (exported from `admin-shell.tsx`) is placed in `<head>` by the
layout owner to apply a stored theme before first paint (no flash). `color-scheme`
also themes native scrollbars/controls.

**Third-party widgets (JS islands) consume tokens as CSS custom properties.** A
library that builds its own DOM (CodeMirror is the precedent — its
`EditorView.theme` in `src/client/markdown-editor.ts` maps `var(--color-surface)`,
`var(--color-ink)`, `var(--color-border-strong)`, `var(--color-ring)`,
`var(--color-accent-soft)`) gets both themes for free because the custom
properties hold `light-dark()` values — never branch on `data-theme` in island
code, and never restate hex values.

## Typography

Three roles, all high-quality **system stacks** — no external fonts (Workers/CSP +
offline dev):

- `font-serif` — editorial display: page `<h1>` (`text-display`), card/dialog
  titles, the wordmark. Book-serif stack (Iowan/Palatino/Georgia fallbacks).
- `font-sans` — all UI and body text. System sans (SF/Segoe/Roboto fallbacks).
- `font-mono` — eyebrows (`text-eyebrow`, mono-caps, wide tracking), table column
  heads, metadata, IDs, timestamps.

Type scale: Tailwind's default sizes plus `text-eyebrow`, `text-display`,
`text-display-sm`. One `<h1>` per page (PageHeader); headings never skip levels —
components take an `as` prop (CardTitle, PageHeader) to fit the page hierarchy.

## Component API conventions

Hono JSX only — plain functions returning JSX, no hooks/`this`/React, `class=` not
`className=`. Import from the barrel: `import { Button, Table } from '@/components/ui'`.

- **Class escape hatch.** Every component takes optional `class?: string`, merged
  **after** base classes so callers can override one-offs.
- **Children** are typed `unknown` (Hono JSX nodes).
- **Variants & sizes are string unions.** Button `variant`: `primary | secondary |
  ghost | danger | link`; `size`: `sm | md | lg | icon`. Badge/Toast `tone`:
  `neutral | accent | success | warning | danger | info`. Reuse this vocabulary in
  new components rather than inventing synonyms.
- **Datastar-friendly by construction.** Form controls (`Input`, `Select`,
  `Textarea`) pass any `data-*` / `aria-*` attribute straight through, so
  `<Input data-bind="title" />` and `<Select data-attr:disabled="$busy" />` work.
  `Button` accepts `busy` (a Datastar expression string like `"$busy"`, or a
  boolean) → disables optimistically + shows a spinner + sets `aria-busy`.
- **Composition over configuration.** `Card` (+ Header/Title/Description/Content/
  Footer) and `Table` (+ Head/Body/Row/HeaderCell/Cell) are helper sets, not
  mega-props. `FormField` wraps a control with a label + help + live error slot and
  exposes `describedBy(fieldId, …)` for the `aria-describedby` id convention.
- **Accessibility is built in, not opt-in:** semantic elements, real `<label>`s,
  `<th scope>`, native `<dialog>` for Dialog/Drawer (focus trap + Esc free), visible
  focus rings, icon-only buttons carry `aria-label`, `aria-current` on the active
  nav item, status pairs colour with a text label (never colour alone).
- **Control heights come from `CONTROL_H`** (`ui/control.ts`: `sm h-8 / md h-10 /
  lg h-11`) — the single source Button, Input, and Select all draw from. Canonical
  height is `md` (40px). **Adjacent controls MUST share a `size`**: a `size="sm"`
  button next to a default `h-10` input is the classic mismatch.
- **Toggle vs Checkbox.** `Toggle` (a native `<input type="checkbox" role="switch">`
  styled as a track+thumb) for a single on/off *state* — boolean fields,
  workflow/access flags, boolean settings. `Checkbox` for an independent multi-option
  group. Both stay **native** (free keyboard/SR semantics; they POST their value).
- **A native checkbox/toggle paints its check from `accent-color`, not `color`.**
  Style the tick with `accent-accent` (the iris token) — `text-accent` sets `color`,
  which a native checkbox ignores, so it silently rendered browser-default blue.
- **No raw field keys in the UI.** Resolve a field's visible label with
  `fieldLabel(field)` (`src/lib/humanize.ts`) = `field.label ?? humanizeKey(field.key)`
  — used by the edit form *and* the list header, so an unlabeled `siteName` reads
  "Site name", never `siteName`.

## Layout primitives

- **AdminShell** (`layouts/admin-shell.tsx`) — fixed 16rem sidebar `Nav` + sticky
  top bar (mobile wordmark/hamburger, theme toggle, user + sign-out) + `<main>`.
  Skip link, `<nav>` landmark, responsive drawer (Datastar `navOpen` signal +
  backdrop + Escape). Content column is centered `max-w-6xl` with generous padding.
- **AuthShell** (`components/auth-shell.tsx`) — centered editorial "title page" for
  `/admin/login`: wordmark over a hairline, mono colophon, single card.
- **PublicShell** (`layouts/public-shell.tsx`, C2) — the anonymous read surface:
  the masthead brand is a **home link** (`settings.logo` image, else the shared
  `Wordmark`), centered `max-w-3xl` main, quiet footer. Same a11y contract as
  AdminShell (skip link → `#main-content`, landmarks); **no admin imports**.
  Generic document bodies render via `DocumentView` + the `FieldView` seam; a
  publicRead collection can instead select a **reading template** (D41,
  `src/templates/`) — the shipped `article` template composes hero → title →
  meta (date · reading time) → **standfirst** (`.rm-standfirst`) → body → share →
  backlinks. Markdown prose styles live in `.rm-prose`; the dek in `.rm-standfirst`
  (`tailwind.css` `@layer components`) — token-driven, not a theme engine.
- **PageHeader** — the masthead of a content region (optional breadcrumb + eyebrow
  + serif `<h1>` + lede + actions slot). It **owns the space below its hairline**
  (`mb-8`) — pages never add an ad-hoc top margin to compensate. **Nav**, **Card**,
  **Table** as above.
- **Breadcrumbs** (`ui/breadcrumb.tsx`) go in the PageHeader on depth-2+ pages
  (built from data already in scope); omit them at depth 1 — a one-item trail is noise.
- **Action hierarchy on editor/detail pages.** Actions + metadata belong in one
  sticky sidebar, not scattered top/bottom: exactly one primary (Save), a secondary
  (Publish), and an isolated destructive (Delete → `Dialog`, never native
  `confirm()`). The sidebar Save can drive the content form in the other column via
  `<button type="submit" form="editor-form">` association (no nested forms). Two
  competing iris-accent primaries on one page is the smell to avoid.
- **Spacing rhythm:** 4px base (Tailwind default scale); cards `gap`/padding in
  multiples of 4/5; page sections separated by `gap-6`+ and hairline rules.

## Empty, loading, and error patterns

- **Empty:** `EmptyState` (icon + serif title + description + optional action) — an
  empty screen must feel intentional. Used by every not-yet-built surface.
- **Loading:** `aria-busy="true"` on the container; `Spinner` + `rm-anim-spin`;
  `Button busy` for in-flight form submits. Skeletons use a `surface` block.
- **Errors (three surfaces):**
  1. *Inline validation* — a route returns a `200` `text/html` fragment morphed by
     id (DATASTAR_PATTERNS.md §d) into `FormField`'s always-present `#{id}-error`
     live region (`role="alert"`), with the control marked `invalid`.
  2. *Unexpected action failure* — `dsError` dispatches the global `app-error`
     CustomEvent; the shell's single `ToastHost` surfaces it as a danger toast.
  3. *Page-level* — an inline notice card (`bg-danger-soft` + `text-danger`).

## Iconography

Inline SVG only (no icon font, no CDN — Workers/CSP + offline). `components/ui/icon.tsx`
holds a Lucide-derived set (24×24 stroke, `currentColor`); each icon is a typed
`IconComponent`. Icons are **decorative by default** (`aria-hidden`) — meaning lives
in the adjacent text or the button's `aria-label`. Add an icon by pasting its Lucide
path data into a new exported function; wire status/nav icons through props, never a
runtime icon-name lookup.
