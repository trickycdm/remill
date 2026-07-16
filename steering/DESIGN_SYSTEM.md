# Design System

> **STATUS: IMPLEMENTED (Phase 1).** Tokens live in `src/tailwind.css`; the owned
> component library lives in `src/components/ui/` (+ `layouts/admin-shell.tsx`,
> `auth-shell.tsx`). This doc explains direction, intent, and usage — it never
> restates hex values or numeric tokens. Every generated admin surface (field
> editors, list cells, tables) composes these primitives, so the design is
> enforced at the primitive level and inherited for free.

## The locked direction — "Overprint" (D43)

remill is a **print shop for the agent age**: a risograph two-ink identity on
real paper stocks. It is a tool people write and publish in all day, so the
working surfaces stay calm and legible; the pop is rationed to the moments
that earn it. The signatures:

- **Two stocks.** Light is cream paper; dark is the **gig-poster register**:
  deep ink-navy stock where the same inks print brighter. One token set,
  `light-dark()` throughout — never a second palette.
- **Two inks plus their overlap.** The **working ink** (riso blue in light,
  cyan in dark) is the everyday accent: actions, links, active nav, focus,
  selection. The **pop ink** (fluoro pink) marks that *something happened*: a
  denial, a publish moment, marketing pop (halftones, offset shadows, stamps)
  — never a workhorse, never body text (see Contrast). Where the two inks
  overprint they multiply to the **overlap violet** — the mark's colour at
  small sizes (wordmark nib, favicon) and the continuity thread to the old
  iris brand.
- **A grotesque masthead.** Display headings and the wordmark are set in
  **Bricolage Grotesque** (`font-display`, the one self-hosted webfont —
  latin variable woff2, preloaded, swap). Body/UI is the system sans.
  Eyebrows, metadata, IDs, and timestamps are mono-caps — the "content tool"
  tell. Never misregister type: the overprint treatment belongs to the MARK
  (≥40px) and display titles (`rm-overprint-title`), nothing else.
- **Stamps mark events.** The `Stamp` primitive is the brand's icon-for-a-
  state: PROOF/SIGN-OFF workflow gates, ALLOWED/DENIED decisions. The label
  carries the meaning, the ink reinforces; tilt at most once per cluster,
  and a screen full of stamps should be Badges instead.
- **Hairlines over boxes.** Structure comes from whitespace and thin rules
  (1px working rules; 1.5px working-ink panel borders on marketing
  showpieces), not heavy shadows or fills. Radii are restrained; motion is
  subtle and always reduced-motion-safe.

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
| `accent` / `accent-hover` / `accent-fg` | Working-ink fill / fill hover / text ON an accent fill — **theme-aware** (white on blue in light, navy on cyan in dark), never use off a fill |
| `accent-text` | Working ink as link/label text on a surface (AA both themes; darker than `accent` in light — the fill fails as body text) |
| `accent-soft` | Tinted wash: active nav, selection |
| `pop` | Pop-ink pink, **graphics / large-bold only** (below body AA by design): halftones, offset shadows, stamp borders |
| `pop-text` / `pop-soft` | Pop ink as text (AA both themes) / its wash |
| `overlap` | The two inks multiplied: the mark below 24px (nib, favicon), graphic-only |
| `ring` / `overlay` | Focus ring / modal backdrop |
| `success` `warning` `danger` `info` | Status **text** tone (AA on surface and on the matching `-soft`) |
| `success-soft` … `info-soft` | Status background washes (badges, toasts, notices) |
| `danger-solid` | Destructive button fill (AA white text, both themes) |

**Contrast:** every text/background pairing meets WCAG 2.1 AA in both themes; base
status tokens are text-safe, solids (`accent`, `danger-solid`) are tuned for AA
`accent-fg`/white text. `scripts/check-contrast.mjs` audits the full pairing table —
run it whenever a token moves; non-obvious ratios are noted inline in `tailwind.css`.

**Contrast rules the palette encodes.**
- **Fill vs text split**: `accent` is a FILL (pair with `accent-fg`, which is
  theme-aware); `accent-text` is the text form. Never use the fill as body text
  (light-mode blue is deliberately below 4.5:1 on cream) and never use
  `accent-fg` off an accent fill (it is navy in dark).
- **Pink is never body text**: `pop` is graphic/large-bold only; `pop-text` is
  the text form. Never white text on a pop fill (2.3:1) — pop fills take no text.
- **The hover fill is the darkest text-bearing background**: `ink-subtle` (and
  everything darker) is tuned AA on `hover`, because axe evaluates hovered rows
  (the pointer rests where the last click happened). Any new text-on-hover
  pairing goes into the contrast script.
- On a **tinted `-soft` wash**, use `text-ink-muted` (not `ink-subtle`) for
  meta text. Build hierarchy with size/weight, never opacity.
- **Dark acts flip the scheme, never the colours**: a section that must render
  dark in both themes (the marketing close: the `#run` band + footer) sets
  `.rm-dark-act` (`color-scheme: dark`) + `bg-canvas` — every `light-dark()`
  token inside resolves to its audited dark value. No literal colours, ever.
- Always axe any new accent/pop surface in **both** themes.

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

Three roles; one self-hosted webfont for the display role, system stacks for the
rest (same-origin `font-src 'self'`, vendored in `public/fonts/`, ~30KB latin
variable woff2, preloaded in `src/layouts.tsx`, `font-display: swap`):

- `font-display` — **Bricolage Grotesque**: page `<h1>` (`text-display`),
  card/dialog titles, the wordmark. Falls back to the sans stack (a grotesque,
  not a serif — the fallback must match the metric class).
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
- **Badge vs Stamp.** A `Badge` reports routine status anywhere. A `Stamp` marks
  a REAL EVENT (a permission decision, a publish gate) and stays rare — `tone`:
  `affirm | event | refuse` (the two pop tones render identically; the label
  carries the valence), `tilt` at most once per cluster and never in dense
  tables. Precedent: audit logs stamp only the denials; allows stay Badges.
- **Datastar-friendly by construction.** Form controls (`Input`, `Select`,
  `Textarea`) pass any `data-*` / `aria-*` attribute straight through, so
  `<Input data-bind="title" />` and `<Select data-attr:disabled="$busy" />` work.
  `Button` accepts `busy` (a Datastar expression string like `"$busy"`, or a
  boolean) → disables optimistically + shows a spinner + sets `aria-busy`.
- **Composition over configuration.** `Card` (+ Header/Title/Description/Content/
  Footer) and `Table` (+ Head/Body/Row/HeaderCell/Cell) are helper sets, not
  mega-props. `FormField` wraps a control with a label + help + live error slot and
  exposes `describedBy(fieldId, …)` for the `aria-describedby` id convention.
- **Card-as-link with inner actions = the stretched link.** When a whole card should
  navigate but also carries its own actions (the `/admin/c` collection cards), never
  nest controls inside an `<a>`-wrapped card. Instead: a positioned wrapper
  (`<li class="relative">`), the title `<a>` stretched over the card with
  `after:absolute after:inset-0`, and each inner action stacked above the overlay
  with `class="relative"`. The whole card stays tappable, the link's accessible name
  stays the title, and the global `:focus-visible` ring lands on the title anchor.
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
  Style the tick with `accent-accent` (the working-ink token) — `text-accent` sets `color`,
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
  + display `<h1>` + lede + actions slot). It **owns the space below its hairline**
  (`mb-8`) — pages never add an ad-hoc top margin to compensate. **Nav**, **Card**,
  **Table** as above.
- **Breadcrumbs** (`ui/breadcrumb.tsx`) go in the PageHeader on depth-2+ pages
  (built from data already in scope); omit them at depth 1 — a one-item trail is noise.
- **Action hierarchy on editor/detail pages.** Actions + metadata belong in one
  sticky sidebar, not scattered top/bottom: exactly one primary (Save), a secondary
  (Publish), and an isolated destructive (Delete → `Dialog`, never native
  `confirm()`). The sidebar Save can drive the content form in the other column via
  `<button type="submit" form="editor-form">` association (no nested forms). Two
  competing working-ink primaries on one page is the smell to avoid.
- **Spacing rhythm:** 4px base (Tailwind default scale); cards `gap`/padding in
  multiples of 4/5; page sections separated by `gap-6`+ and hairline rules.

## Empty, loading, and error patterns

- **Empty:** `EmptyState` (icon + display title + description + optional action) — an
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
