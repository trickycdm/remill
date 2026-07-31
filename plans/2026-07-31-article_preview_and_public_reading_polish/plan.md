# Article preview + public reading-surface refinements

**Status: COMPLETE — 2026-07-31**

All four parts shipped as planned (no re-plans): draft preview (D49), the tear-off share
colophon, the serif-italic prose byline, and the reading-column/wordmark alignment.
Verified: 529 unit tests, 79 e2e (incl. the new `e2e/draft-preview.spec.ts`), lint,
type-check, `check-contrast.mjs`, plus a screenshot pass (edit page, draft preview
banner, published article light + dark).

## Context

Four improvements to remill, one functional, three stylistic:

1. **Draft preview.** The admin edit page's "View" button goes to an internal admin render, and the public page link only appears once an article is published. There is currently **no way to preview a draft as it will appear publicly** — the public route hardcodes `anonymousPrincipal`, so drafts 404 even for a logged-in admin. Authors need a prominent Preview action that works in both draft and published states, and the edit page's action hierarchy needs tidying.
2. **Share bar overhaul.** The public article share bar (Share / Copy link / Share…) is bland hand-rolled markup outside the design system. Direction chosen by Colin: **"tear-off colophon"** — perforated rule, mono eyebrow, design-system icon buttons, pop-ink "Copied" flash.
3. **Byline refinement.** The article date renders as raw ISO (`2026-07-05`, the settings default). Wanted: full prose date (weekday, day, month, year) + reading time, in a slightly different font, smaller, italicized.
4. **Logo alignment.** The masthead wordmark reads ~1px right of the body text's left edge — an optical inset inside the PenNib SVG glyph, not a container bug (header and main share the same `max-w-3xl px-6` container).

Verified feasibility facts the plan relies on:
- `sessionSetup()` runs globally (`src/main.tsx:63`) before routes, so the public route can call `getSessionUser(c)` (`src/lib/auth.ts:39`) with no middleware changes. Precedent: `src/routes/oauth/authorize/index.tsx:210`.
- `principalFromSession` + `compileReadFilter` (`src/access/authorize.ts`) already give the right fail-closed matrix: admin/editor read drafts (unconditional read), authors read own drafts, readers/anonymous get 404. **No access-layer, service, or query changes needed.** The closed condition enum is untouched.
- `getDocumentBySlug` resolves draft slugs (document_index has no status column; the filter does the gating).
- Tailwind v4 ships a default `--font-serif` stack with real italics — no new webfont needed (Bricolage has no italic face; must never be synthesized).
- `settings.dateFormat` options are seeded **data** (`src/db/seed.sql`) live in production — so the prose date must be **template-driven**, not a new settings option.

---

## Part 1 — Draft preview (functional) — DONE

Mechanism: `?preview=1` on the public route swaps the anonymous principal for the session principal. Same `authorize()` pipeline, real principal, no bypass, no new action.

### 1a. `src/layouts.tsx` — noindex head prop
Add optional `noindex?: boolean` to `PageHead`; render `<meta name="robots" content="noindex" />` when set.

### 1b. `src/components/layouts/public-shell.tsx` — preview banner
New optional prop `preview?: { editHref: string; status: 'draft' | 'published' }`. Slim full-width bar above the masthead (skip link stays first):
- Draft: "Draft preview — this page is not publicly visible."
- Published: "Preview — this is the live published page."
- Right-aligned "Back to editor" link → `editHref`. Tokens only (AA-audited pairing, e.g. `bg-accent text-accent-fg`); no admin imports.

### 1c. `src/routes/[collection]/[slug]/index.tsx` — the mechanism
- `previewRequested = c.req.query('preview') != null`.
- If requested and `getSessionUser(c)` is null → redirect `/admin/login?redirect=<pathname+search>` (build from `new URL(c.req.url)`; happens **before any lookup** — no draft-existence oracle). Login already validates same-origin-relative redirects.
- If session → `principal = principalFromSession(user)`; else anonymous exactly as today. Without the flag, logged-in admins see exactly what anonymous sees (deliberate).
- In preview mode: `c.header('Cache-Control', 'no-store')` (also before the raw-mode `c.html` return), `noindex: true` head prop, `preview={{ editHref: /admin/c/${collection}/${doc.id}, status: doc.status }}` on PublicShell. Canonical stays as-is.
- Failures collapse to the same indistinguishable 404 (reader-role session previewing a draft → 404, fail-closed).
- Raw mode (D27) drafts preview verbatim with no banner (the document IS the page) — still no-store; note in route comment.
- Backlinks use the same session principal (one principal per request; note the trade-off in a comment).
- Update the route docblock ("No auth: …" is being relaxed).

### 1d. `src/routes/admin/c/[collection]/[id]/index.tsx` — edit-page hierarchy
Compute `previewHref` with the same slug heuristic as `view.tsx:32-37` (slug-type indexed field, fall back to `doc_` id — covers drafts with empty slugs).

Header `actions`:
- publicRead collections: **`Preview ↗`** as `variant="secondary" size="sm"`, `target="_blank" rel="noopener"`, aria-label noting new tab — works for drafts AND published; plus the existing internal **`View`** demoted to ghost beside it.
- non-publicRead collections: no Preview; promote View to `secondary` so the header always has one visible affordance.

Sidebar (`editor-sidebar.tsx`) unchanged — Save stays the page's only primary; header = navigation, sidebar = mutation.

### 1e. `src/routes/admin/c/[collection]/[id]/view.tsx` — consistency
Relax the `publicHref` gate: for publicRead collections always build the URL; unpublished → append `?preview=1`, label "Preview ↗"; published → keep "Public page ↗".

### 1f. Decision log
Add **D49** to `docs/TECH_DECISIONS.md`: session-principal preview on the public render route (mechanism, no-store + noindex, redirect-before-lookup; rejected alternatives: separate admin preview route, signed preview tokens, always-on session reads). Update CLAUDE.md architecture line + ACCESS_CONTROL framing at wrap-up (they state the anonymous-only public read). The closed condition enum is NOT extended — note explicitly in the PR.

---

## Part 2 — Share bar: tear-off colophon — DONE

### 2a. `src/components/ui/icon.tsx`
Add `LinkIcon` and `ShareIcon` (Lucide-derived paths, existing paste-the-path convention; `DatabaseIcon` suffix precedent).

### 2b. `src/components/ui/button.tsx`
Extend `ButtonBase` with a `data-*` attribute signature (`` [key: `data-${string}`]: string | boolean | undefined ``) so islands can pass carrier attributes. Props already spread — type-only change.

### 2c. `src/components/share-bar.tsx`
- Section: `rm-perf` (dashed riso "tear here" rule) replacing `border-t border-border`; keep `mt-2 pt-6`, `aria-label="Share"`, `data-share`; add `rm-measure` (Part 4).
- Label: mono eyebrow matching the Details zone — `font-mono text-eyebrow font-medium tracking-[0.1em] uppercase text-ink-subtle`.
- Buttons: `<Button variant="secondary" size="sm">` with leading `size-3.5` decorative icons; labels stay exactly "Copy link" / "Share…" (e2e depends on accessible names); keep all `data-share-*` carriers.
- Status: keep `role="status" aria-live="polite"`; restyle `text-sm text-pop-text` — the page's one pop-ink moment (AA-audited token).
- No-JS fallback links: same hrefs/`rel="noopener"`, restyled `text-sm text-accent-text underline decoration-1 underline-offset-4 hover:decoration-2`.

### 2d. `src/client/share.ts`
`js.classList.replace('hidden', 'flex')` instead of `remove('hidden')` — fixes the latent bug where the revealed div falls back to `display:block` and its flex classes are inert. Everything else unchanged.

### 2e. `src/templates/prompt.tsx` cleanup
It declares `wants: { shareBar: true }` (island ships) but never renders ShareBar. Render `{ctx.shareUrl ? <ShareBar url={ctx.shareUrl} title={title} /> : null}` before Backlinks — matches the file's own docstring. `portfolio.tsx` inherits the redesign automatically.

---

## Part 3 — Byline: full prose date, serif italic — DONE

### 3a. `src/lib/format-date.ts`
- Add `full` preset: `en-GB`, `{ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }` → "Thursday 5 July 2026". Unit-test against actual ICU runtime output (comma placement is CLDR-version-dependent).
- Add optional third param `preset?` that wins over `settings.dateFormat` (backward-compatible; timezone still from settings). Fix the docstring claim that presets "mirror the settings select" — `full` is template-only; the seeded select options (live production data) are untouched.

### 3b. `src/templates/article.tsx` meta line (lines 63–71)
`<p class="rm-measure flex flex-wrap items-center gap-x-2 font-serif text-[13px] italic text-ink-subtle">` — serif system italics (the "slightly different font"), one step below `text-sm`, same audited ink. Call `formatDate(published, ctx.settings, 'full')`. Keep `<time datetime>`, the `aria-hidden` `·`, and `{n} min read` verbatim (tests target these). Changelog stays as-is (a release entry is a record, not an essay).

### 3c. `src/tailwind.css`
Optionally declare `--font-serif` explicitly in `@theme` (Tailwind's default value) with a one-line comment, keeping tokens canonical in one file.

### 3d. `src/components/document-view.tsx:55` cleanup
Replace `doc.publishedAt.slice(0, 10)` with `formatDate(doc.publishedAt, settings)` via a new optional `settings` prop; pass from `[collection]/[slug]/index.tsx` and `s/[token]/index.tsx` (both have settings in scope); admin view may omit (identical output).

---

## Part 4 — Column rhythm + logo — DONE

### 4a. `src/tailwind.css`
Add `.rm-measure { max-width: 65ch; }` to `@layer components` (next to `.rm-standfirst`, which stays as-is).

### 4b. `src/templates/article.tsx`
Apply `rm-measure` to the `<header>` and Details `<section>` so text and hairlines end at the prose measure (ShareBar carries it per 2c). Hero figure deliberately stays full-width (editorial contrast). `src/components/backlinks.tsx`: add the conventional `class?: string` escape hatch, pass `rm-measure` from article.tsx only.

### 4c. `src/components/ui/wordmark.tsx`
Add `-ml-px` to the PenNib icon. Math: visible ink starts ≈1.3/24 units in; at `size-5` (20px) ≈1.1px → 1px correction (`-ml-0.5` would overshoot). Fixes every flush-left Wordmark placement at once. The `settings.logo` `<img>` case gets no correction (arbitrary raster).

---

## Tests & verification — DONE (all gates green)

**Unit (Vitest):**
- `src/lib/format-date.test.ts`: `full` preset (basic, timezone rollover, override-beats-settings).
- `src/services/documents/documents.test.ts`: editor reads draft by slug in publicRead collection; author reads own draft / rejected on another's; reader rejected (the invariants preview depends on).
- `src/templates/article.test.tsx`: existing assertions (`min read`, `time datetime`, `aria-label="Share"`, `data-share-copy`) survive; add prose-date + `rm-perf` assertions.
- `src/templates/pack-lineup.test.tsx` / `prompt-pack.test.ts`: add a prompt-template `data-share-copy` assertion for 2e.

**E2E (Playwright)** — new `e2e/draft-preview.spec.ts` (own CF-Connecting-IP, serial, modeled on `public-reading.spec.ts`):
1. Create draft article → edit page shows secondary "Preview" (`href` matches `?preview=1`, `target="_blank"`) + ghost View.
2. Authed `goto(previewUrl)`: h1, draft banner, `meta[name=robots][content=noindex]`, "Back to editor" round-trip.
3. Anonymous context: bare URL → 404; `?preview=1` → login redirect → arrives back at preview after login.
4. Publish → published-variant banner with flag; bare anonymous URL has no banner/noindex.
5. Non-publicRead collection: no Preview button.
6. Axe sweep on preview page (banner contrast).

Existing `e2e/public-reading.spec.ts` assertions (`/\d+ min read/`, `getByRole('button', {name: 'Copy link'})`, `locator('time')`) survive by design.

**Gates:** `bun run type-check && bun run lint && bun run test:run`; clean `bun run e2e` (kill :3100, `rm -rf .wrangler/state/v3/d1` first — dirty D1 gotcha); `node scripts/check-contrast.mjs` no-regression. Manual: `bun run dev` → walk draft/published preview flows; visual pass on an article in both themes (perf rule alignment, byline, button heights, "Copied" pop flash, no-JS fallback with JS disabled, masthead nib vs body left edge at zoom).

**Docs:** D49 in `docs/TECH_DECISIONS.md`; DESIGN_SYSTEM.md — share bar is the tear-off colophon, `rm-perf` no longer marketing-only, plus two recorded deviations (serif-italic editorial byline vs mono-timestamp convention; pop-text for the transient copy confirmation). CLAUDE.md architecture line + ACCESS_CONTROL anonymous-only framing updated.

## Sequencing

1. Part 3 (formatDate + byline — self-contained) → 2. Part 2 (icons → Button types → ShareBar → island → prompt) → 3. Part 4 (measure + wordmark) → 4. Part 1 (noindex → banner → route mechanism → edit header → view.tsx) → 5. tests → 6. docs/D49.

## Revision Log

- 2026-07-31: Executed exactly as planned — no re-plans. Two implementation-level notes:
  the meta line's `rm-measure` is redundant once the header carries it (left harmless);
  the Lucide link icon's second path needed its correct negative arc sign.
