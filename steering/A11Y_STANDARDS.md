# Accessibility Standards

> **STATUS: IMPLEMENTED (standing standard).** Target **WCAG 2.1 AA**. Every admin component and page
> meets these from the day it is built; the axe sweep runs in e2e (`bun run e2e`). Concrete colour
> tokens live in `tailwind.css` `@theme` and are documented in DESIGN_SYSTEM.md — this doc never
> restates hex values.

The admin is a designed product used daily, and its surfaces are **generated** from field descriptors —
so accessibility is enforced at the primitive level (`Button`, `Input`, `Table`, `Drawer`, field
edit/cell components), where it composes into every generated view for free. Get the primitives right
and the whole generated admin inherits it.

## Semantic HTML & landmarks

- Use `<main>`, `<nav>`, `<header>`, `<footer>`, `<section>`, `<aside>` over generic `<div>` for
  landmark content. Each page has exactly one `<main>` (the shell layout provides it).
- `<section>` must have a heading or `aria-label` / `aria-labelledby`.
- Every layout includes a **skip-to-content link** as the first focusable element:
  `<a href="#main-content" class="sr-only focus:not-sr-only …">Skip to content</a>`.
- Use `<ul>`/`<ol>`/`<li>` for lists, not styled `<div>` sequences. Use `<table>` semantics for the
  generated list view — real `<th scope>`, `<caption>` or `aria-label`.

## Heading hierarchy

- Every page has exactly one `h1`. Headings never skip levels (no `h1` → `h3`).
- Component-internal headings accept an `as` prop or pick the level from context — a card title inside
  a page is `h2`/`h3`, never a hard-coded `h1`.

## Keyboard navigation

- All interactive elements are reachable via Tab; focus order matches visual reading order.
- Custom controls (dropdowns, menus, tabs) support Arrow keys, Escape, and Enter/Space per the
  [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/).
- Modals/drawers/dropdowns **trap focus** while open and **return focus to the trigger** on close.
  Prefer the native `<dialog>` element (Escape-to-close + focus management for free); implement a
  manual focus trap only where `<dialog>` doesn't fit.
- No positive `tabIndex` values.

## Focus indicators

- Every interactive element shows a visible focus ring — use `focus-visible:outline` with a focus
  token from DESIGN_SYSTEM.md. Never remove a focus outline without a visible replacement.

## ARIA patterns

- **Icon-only buttons**: always provide `aria-label`.
- **Decorative images/SVGs**: `aria-hidden="true"` and `alt=""`.
- **Informational images**: descriptive `alt` reflecting content/purpose.
- **Tabs**: `role="tablist"` / `role="tab"` / `role="tabpanel"` + `aria-selected`.
- **Expand/collapse triggers**: `aria-expanded` (bind to the Datastar signal via `data-attr:aria-expanded`).
- **Loading containers**: `aria-busy="true"` while loading.
- **Disabled**: use the `disabled` attribute, not just `opacity`/`pointer-events`.
- **No ARIA misuse**: don't put `role="button"` on an `<a>` that navigates — use the right element.

## Dynamic content & live regions (Datastar)

Datastar morphs server-returned HTML into the DOM after the initial render, so screen readers only
announce it if the live region **exists in the initial server render**:

- Add `aria-live="polite"` to any container that later receives a `datastar-patch-elements` patch
  (save feedback, upload progress, inline results) — in the first render, before the patch arrives.
- **Error messages / inline validation** (the `#…-result` fragments): wrap in `role="alert"` or
  `aria-live="assertive"` so they announce immediately. Link field errors to the input via
  `aria-describedby`.

## Forms (the generated edit view)

- Every `<input>`/`<textarea>`/`<select>` has a visible `<label>` associated via `htmlFor`/`id`.
  Field edit components emit this by construction so every generated form is labelled.
- Required fields use the `required` attribute, not just a visual asterisk.
- Help/description text below an input is linked via `aria-describedby`.
- Validation errors are linked to their input via `aria-describedby` and announced (above).
- Group related fields with `<fieldset>`/`<legend>` where appropriate.

## Images & alt text (load-bearing for a CMS)

- **Alt text is required for image media.** The `media` field type and the media library enforce an
  alt-text field for images; publishing an image document without alt is a validation error (finalised
  in MEDIA_STANDARDS.md, Phase 5). A CMS that lets editors ship imageless-alt content fails its own
  accessibility mandate.
- Decorative images explicitly opt out with `alt=""` — an empty alt is a deliberate choice, not a
  missing one.

## Colour & contrast

- Body text meets **4.5:1**; large text and UI components meet **3:1**. Contrast is verified against
  the DESIGN_SYSTEM.md token pairings (both light and dark themes — remill ships both from day one).
- **Never rely on colour alone.** Status (draft/published, allow/deny, error/success) always pairs the
  colour with a text label or icon.
- Interactive states (hover, active, disabled, focus) stay distinguishable without colour.

## Motion

- Wrap every CSS animation in `@media (prefers-reduced-motion: reduce)` to disable or reduce it to an
  instant/opacity-only transition. JS-driven staggered delays check
  `matchMedia('(prefers-reduced-motion: reduce)')` and set delay to 0.
- No content flashes more than 3 times per second.

## Testing

- **Run the axe-core sweep on every admin page.** `@axe-core/playwright` runs against each key admin
  route in the e2e a11y spec; **every new page is added to the sweep** and must report zero violations.
  See E2E_TESTING.md.
- Manual keyboard-only navigation for every new interactive component.
- Screen-reader spot-check (VoiceOver on macOS) for critical flows: login, create/edit document,
  upload media, manage access.
