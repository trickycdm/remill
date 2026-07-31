# Homepage redesign — bold, product-led, re-architected

**Status: COMPLETE — 2026-07-09**

## Context

The homepage (`/`, served by `src/routes/index.tsx`) is already a six-section marketing
page (`src/components/marketing.tsx` inside `MarketingShell`), but the user finds it "boring
and pretty confusing." Diagnosis:

- **Boring** — six near-identical quiet editorial sections (hairlines + muted ink, the one
  iris accent used sparingly). No visual anchor, no color, no energy.
- **Confusing** — no clear narrative. The product's single best idea ("one collection
  definition generates six surfaces") is buried as abstract section 4, and the page never
  delivers on its own headline promise (humans / apps / agents). It also mixes "sell the
  platform" with "here's my writing."

**User decisions (confirmed):**
1. **Primary job:** Product showcase leads; published writing is demoted below.
2. **Boldness:** Push it bold — use the iris accent as a real color field (an accent-fill
   hero band, accent-soft section bands), bigger display type, more motion, one striking
   moment. Still 100% on-token (no new colors).
3. **Scope:** Re-architect — free to merge/cut/reorder sections and add a signature visual.

**Keep (user likes these, and tests depend on them):** the eyebrow "Content, milled" and
the H1 "Content that works for humans, apps, and agents."

**Hard constraints (this repo):** Hono JSX only (`class=`, no React), Datastar v1 for any
interactivity, system fonts only, **no external images (CSP)** — so visual interest comes
from type, the iris accent as color fields, real UI-primitive previews (never fake
screenshots), and CSS motion. Tokens only (`bg-accent`, `bg-accent-soft`, `text-accent-text`
…), never raw hex. Motion via the existing `rm-anim-*` / `rm-scroll-rise` classes
(reduced-motion safe by construction). Reuse the existing icon set, `Button`, `Badge`,
`Table`, `EmptyState`. Read `steering/DESIGN_SYSTEM.md`, `steering/DATASTAR_PATTERNS.md`,
`steering/A11Y_STANDARDS.md` before touching the relevant parts.

## New information architecture (5 sections, each a distinct layout family)

The narrative now maps directly to the headline and leads with the product:
**promise → proof → trust → connect → writing.**

### 1. Hero — accent-fill editorial-manifesto band (bold moment)
- Full-bleed `bg-accent` section (the accent statement replaces today's quiet centered
  stack). Inner `max-w-5xl px-6`, **left-aligned** (kills the current center bias),
  `rm-anim-rise` entrance, top padding capped at `pt-24`.
- Content = exactly 4 elements: eyebrow "Content, milled" (mono caps) · H1 (serif
  `text-display-lg`, `text-balance`, constrain measure so it stays **≤ 2 lines**) · subtext
  (≤ 20 words) · two CTAs.
- **Text color:** all copy is full white on the accent field for guaranteed AA (white on
  accent is ~7.9:1 light / ~5.7:1 dark — see `tailwind.css:80-82`). Build hierarchy with
  size/weight/tracking, **not** opacity, so nothing dips below AA.
- **CTAs on accent** (the normal `primary` = accent fill is invisible here, so invert):
  - Primary "Connect an agent" → `#connect`: a light button (`bg-surface-raised`/white)
    with `text-accent` label (accent-on-white ≈ 7.9:1).
  - Secondary "Browse the writing" → `#writing`: white-outline ghost, white label.
  - Verify both against the accent band (Button Contrast Check).
- **No** chip strip / decoration line / version label / scroll cue at the hero bottom.

### 2. "One definition, every surface" — interactive Datastar demo (the centerpiece)
This is the replacement for today's `SixSurfaces` and folds in `CalmAdminSplit`. It proves
the six-surfaces idea *and* the humans/apps/agents promise in one interactive family. On
canvas.
- H2 (serif display, no eyebrow): "One definition works for humans, apps, and agents."
- **Left:** the real Essays collection definition — the existing keyboard-operable mono
  `<pre role="region" aria-label=…>` JSON block (reuse from `SixSurfaces`, marketing.tsx:169).
- **Right:** a segmented control **[ Admin · REST API · Agents ]** driven by a Datastar
  signal that swaps the preview panel:
  - **Admin** → the real `Table`+`Badge` list preview (move the markup from `CalmAdminSplit`,
    marketing.tsx:77-108, verbatim — it is real primitives, so axe-clean).
  - **REST API** → a real REST JSON response snippet in a `CODE_BLOCK` panel.
  - **Agents** → a real MCP tool-call snippet in a `CODE_BLOCK` panel.
- **Datastar (consult `/datastar` skill first — v1 syntax):** pure client-side signal, no
  SSE. All three panels render server-side into the DOM; `data-signals` holds the active tab,
  `data-on-click` sets it, `data-show` toggles panel visibility (default Admin). Datastar is
  already loaded globally (`layouts.tsx`), so no custom island is needed.
- **A11y (tabs pattern, per A11Y_STANDARDS.md):** `role="tablist"` / `role="tab"` buttons
  with `aria-selected` bound to the signal + `aria-controls`; panels `role="tabpanel"`;
  hidden panels genuinely hidden (so screen readers/axe skip them); active tab indicated by
  **more than color** (accent-soft fill + weight/underline). Buttons are natively focusable.
- Optional swap transition via `rm-anim-fade` (reduced-motion safe).

### 3. "Built for trust" — bento grid
Replaces the monotonous `OutcomesLedger` hairline list with a real grid. On a `bg-surface`
or `bg-accent-soft` band.
- H2 (serif, no eyebrow). **Exactly 4 cells** (no empty cells), varied sizes for rhythm,
  **≥ 2 cells tinted `bg-accent-soft`** for background diversity, each cell = icon + short
  lead + ≤ 25-word body. Source the four points from the existing `OUTCOMES` copy
  (marketing.tsx:115-132), trimmed, with icons from the existing set (`Bot`, `ShieldCheck`,
  `Braces`, `FileText`/`DatabaseIcon`): agent identity + least-privilege · one
  authorized/audited write pipeline · publishing built in (RSS/sitemap/share links/scheduled)
  · API + full-text search + revisions + trash.

### 4. Agent quickstart (`#connect`) — the conversion target
Keep this section largely intact (it already works and the tests depend on it), restyled onto
a `bg-accent-soft` band (bold-ish, ink text stays AA).
- Eyebrow "For agents" (this is the 2nd and final eyebrow) · H2 "Connect an agent".
- Numbered steps 1-3 + real MCP config + `curl`, interpolating `${baseUrl}/mcp` (keep the
  `/mcp` string). Keep the closing self-host note. Zero em-dashes.

### 5. Latest writing (`#writing`) — demoted content index
Keep `PublishedIndex` essentially as-is (product-led = writing lives lower). On canvas.
- H2 "Latest writing" · per-collection `<h3>` + doc links + dates · `EmptyState` fallback
  with "Nothing published yet" + Sign in. Optionally feature the newest item; keep it simple.

**Eyebrow budget:** 2 total (hero + quickstart) across 5 sections — within the ≤ ceil(5/3)
rule. **Layout families:** 5 distinct (accent manifesto / interactive split / bento / numbered
steps+code / writing list) — no repetition, no 3-in-a-row zigzag.

## Files to modify

- **`src/components/marketing.tsx`** (primary rewrite):
  - `MarketingHero` → accent-fill left-aligned manifesto band with inverted CTAs.
  - Delete `CalmAdminSplit`; its Table preview becomes the demo's "Admin" panel.
  - Replace `SixSurfaces` with `EverySurface` (interactive Datastar segmented demo).
  - Replace `OutcomesLedger` with `TrustBento` (4-cell bento).
  - `AgentQuickstart` — restyle onto accent-soft; keep steps/code/anchors/`/mcp`.
  - `PublishedIndex` — keep; minor polish.
- **`src/routes/index.tsx`** — update the `c.render(<MarketingShell>…)` composition to the
  new section set/order. Head props (`title: 'remill: content, milled'`, description,
  canonical, og, feed) stay unchanged.
- **`src/components/layouts/marketing-shell.tsx`** — small: drop the now-redundant top accent
  hairline (marketing-shell.tsx:27-28) since the hero band is the accent statement; keep the
  single-line header (Wordmark · Writing · Sign in) and footer.
- **`src/tailwind.css`** — aim for **zero** new CSS (reuse `rm-anim-rise`, `rm-scroll-rise`,
  `rm-anim-fade`). If a new keyframe is truly needed, gate it exactly like `rm-scroll-rise`
  (tailwind.css:297-324): `@supports (animation-timeline)` + `prefers-reduced-motion:
  no-preference`, plus the blanket reduced-motion kill switch.

## Anti-slop guardrails (pre-flight before shipping)

Zero em-dashes anywhere. One accent hue used consistently (hero band, accent-soft bands,
links, icons). One radius scale (existing tokens). Hero fits the viewport, ≤ 2-line headline,
≤ 20-word subtext, `pt-24` max, ≤ 4 text elements. ≤ 2 eyebrows total. Every CTA passes AA
against its background (especially the two on the accent band). Bento has exactly 4 cells with
real visual variation. No fake screenshots — previews are real primitives. No decorative dots,
version labels, locale strips, or scroll cues. All motion reduced-motion safe.

## Test updates

Because the contract strings are preserved, churn is small:
- **`src/components/marketing.test.tsx`** — should still pass unchanged: it asserts the H1
  text (kept), "Nothing published yet" (kept), `id="connect"` (kept), and `.../mcp` (kept).
  Re-run to confirm; adjust only if a preserved string moved.
- **`e2e/public-discovery.spec.ts`** (lines 101-147) — should still pass: one `<h1>`, primary
  CTA "Connect an agent" → `#connect` scrolls the "Connect an agent" heading into view and
  `#connect` contains `/mcp`; secondary CTA "Browse the writing" → `#writing` visible;
  "Stories" heading + published link + no draft; **axe-clean in light AND dark.** The dark-mode
  axe pass over the new accent hero is the main new risk — verify. Optionally add a small
  assertion that the demo's segmented control swaps panels.

## Verification (end-to-end)

1. `bun run type-check` and `bun run lint` clean.
2. `bun run test:run` — unit incl. `marketing.test.tsx` green.
3. `bun run e2e` — Playwright + axe green (both color schemes).
4. `bun run dev`, open `/`, and eyeball in **both** light and dark, at desktop and mobile
   widths (drive via the browser tools / `/run`): the accent hero is legible and striking,
   the interactive demo toggles Admin/REST/Agents correctly with hidden panels inert, the
   bento reads well, and nothing scrolls horizontally. Confirm reduced-motion (`prefers-
   reduced-motion: reduce`) renders everything static.
5. Sanity-check the anti-slop guardrail list above against the rendered page before calling
   it done.

## Out of scope

No new routes, no schema/collection changes, no new dependencies, no external assets. Copy
edits limited to the sections above; the D35/D36 head-props and discovery data path are
untouched.

## Outcome (what shipped)

All five sections landed as specified. `MarketingHero` (iris-band manifesto, inverted CTAs),
`EverySurface` (Datastar segmented Admin/REST/Agents preview), `TrustBento` (4-cell asymmetric
bento, two iris-washed cells), the restyled `AgentQuickstart` (iris-soft band), and the demoted
`PublishedIndex`. `CalmAdminSplit` / `SixSurfaces` / `OutcomesLedger` removed; the shell's top
hairline dropped. Contract strings preserved, so `marketing.test.tsx` passed unchanged.

**Verified:** `type-check`, full `lint`, `prettier` clean; **359 unit tests** pass; the
`public-discovery` e2e spec (7 tests) passes — including **axe-clean in both light and dark**,
one `<h1>`, working CTAs, and a **new e2e test driving the Datastar toggle**. Light/dark/mobile
eyeballed via Playwright screenshots.

## Revision Log

- 2026-07-09: **Dark-mode AA fix (found in verification).** The dark axe pass flagged
  `text-ink-subtle` on the `bg-accent-soft` quickstart band at 4.19:1 (< 4.5:1) — the "For agents"
  eyebrow and the closing self-host note. `ink-subtle` is only tuned AA on canvas/surface; on the
  iris wash it dips. Switched both to `text-ink-muted` (much lighter in dark). Lesson for
  DESIGN_SYSTEM.md: `ink-subtle` is not AA on `accent-soft` in dark; use `ink-muted` on tinted bands.
- 2026-07-09: Minor implementation choices vs. plan — REST/Agents panels use a local `PANEL`
  (`bg-surface`) rather than the quickstart `CODE_BLOCK`; the bento sits on canvas with a
  `border-t` (narrow cells `bg-surface` + shadow, wide cells `bg-accent-soft`); `EverySurface`
  needs no `baseUrl` (its snippets use relative paths). The demo's active tab is indicated by
  weight + border, not colour alone (WCAG 1.4.1). Added the optional Datastar-toggle e2e test.
