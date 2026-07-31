# Overprint rebrand: site + design system overhaul

## Context

The homepage went through two rounds of design exploration (artifacts: sectioning concepts, then brand directions). The winner is the **"Overprint / Pressrun hybrid"**: a risograph two-ink identity — riso blue working ink + fluoro pink pop ink on cream stock, hairline card language, chunky grotesque display type, rubber-stamp state markers — replacing the current "Ink & Paper" system (warm paper, iris accent, book serif). Decisions locked with Colin:

- **One token set for everything**; the admin uses the same tokens with pink rationed to real events (denials, publish moments).
- **Dark theme = the "gig poster" register**: deep ink-navy stock, cyan working ink, pink pop.
- **Display face = self-hosted Bricolage Grotesque** (OFL, variable woff2, latin subset); body/mono stay system stacks. CSP already allows same-origin fonts.
- **The mark survives**: the PenNib glyph keeps its geometry; overprint (two-ink misregistered, multiply) at ≥40px display sizes only; single-ink **overlap violet** below 24px (wordmark nib, favicon).
- Brand reference: artifact https://claude.ai/code/artifact/7afcfcf1-974d-441d-b685-ab0397d9fab9 (Pressrun tab = target language; Iconography tab = mark/stamp rules).

Why it's tractable: the palette has **one source of truth** (`src/tailwind.css` `@theme`, `light-dark()` pairs) with only two hardcoded mirrors (`src/lib/email/templates.ts`, `public/favicon.svg`); the display font is a utility rename across 22 files; there are **no screenshot baselines** — the gates are 12 axe e2e specs (one dark-mode) and pinned copy strings.

## Phasing (5 PRs, site coherent at every merge)

| Phase | Ships | Visible change |
|---|---|---|
| P0 | Font asset + contrast script | none (inert) |
| P1 | Tokens, font, `font-serif→font-display` codemod, favicon, wordmark, theme-color metas | whole app re-skins mechanically |
| P2 | Homepage recomposition + `Stamp` component | homepage |
| P3 | 404 on-system, email palette mirror, admin Stamp adoption, template polish | stragglers |
| P4 | Steering docs + D43 decision log | docs |

---

## P0 — Brand kit groundwork (inert)

- `public/fonts/bricolage-grotesque-latin-wght.woff2` (new): vendor from `@fontsource-variable/bricolage-grotesque` (copy the file — no runtime dep, same posture as vendored datastar.js). If >40KB: `fonttools varLib.instancer … wght=500:800` + `pyftsubset --flavor=woff2 --unicodes=U+0000-00FF,U+2013-2014,U+2018-201D,U+2026`. Target ≤35KB. Add `public/fonts/LICENSE-OFL.txt`.
- `scripts/check-contrast.mjs` (new): WCAG ratio calculator over the P1 token table, both themes. Manual tool; axe stays the CI gate.

**Verify:** type-check/lint unaffected; run the script, record tuned hex in the PR description.

## P1 — Token layer + font + codemod (the mechanical reskin)

### Tokens — `src/tailwind.css` (candidate values, AA-tune with the P0 script)

- Neutrals: `canvas light-dark(#f6f1e3, #191c30)`, `surface (#fbf8ee, #232741)`, `surface-raised (#fffdf6, #2a2f4e)`, `hover (#ece5d2, #2e3452)`, `ink (#23364a, #f2ecdd)`, `ink-muted (#4a5c6e, #bcb9c4)`, `ink-subtle (#5b6c7d, #9d9aad)`, `border (#ddd6c6, #333858)`, `border-strong (#c9c0aa, #454b6e)`.
- Working ink: `accent light-dark(#0078bf, #4dd8e6)`, `accent-hover (#0069a8, #71e2ec)`, **`accent-fg light-dark(#ffffff, #10233c)`** ← becomes theme-aware (was static white); this is the load-bearing change that keeps every accent fill AA in both themes, and lets P1 merge with the existing iris-band hero degrading to a clean solid-ink band (blue/white 4.7:1 light; cyan/navy ~9.8:1 dark). `accent-text light-dark(#00639c, #4dd8e6)` (NOT #0078bf as text — only 4.2:1 on cream). `accent-soft (#ddeaf3, #14364a)`.
- Pop ink (new): `pop #ff48b0` (graphics/borders/shadows/large-bold ONLY — 3.2:1 on cream), `pop-text light-dark(#b8156e, #ff77c4)` (pink as text), `pop-soft (#fbe3ef, #3d1a30)`. **Never white-on-pink fills (2.3:1).**
- Tertiary: `overlap light-dark(#5348b8, #a89cf0)` (mark/favicon continuity violet).
- `ring light-dark(#0078bf, #4dd8e6)`; semantics (success/warning/danger/info + softs + danger-solid) re-tinted to the new stocks — danger stays red, distinct from pop pink.
- `--radius-lg` 0.625rem→0.75rem; shadows re-tinted warm→cool `rgba(25,28,48,…)`, md/lg spread reduced ~25%.

### Font

- `@font-face` for `'Bricolage Grotesque'` (woff2-variations, `font-weight: 500 800`, `font-display: swap`, latin unicode-range) after the tailwind import; delete `--font-serif`, add `--font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif` (sans fallback, not serif). Update `.rm-prose` headings from `var(--font-serif)`.
- Codemod (35 hits / 22 tsx files, none in tests): `grep -rl 'font-serif' src --include='*.tsx' | xargs sed -i '' 's/font-serif/font-display/g'` then grep-verify zero remain.
- `src/layouts.tsx` head: font `<link rel="preload" … as="font" crossorigin>` + two `theme-color` metas (`#f6f1e3` light / `#191c30` dark).

### Brand assets

- `public/favicon.svg`: strokes `#4b44a3→#5348b8`, dark override `#b3a9f5→#a89cf0`. Geometry unchanged.
- `src/components/ui/wordmark.tsx`: nib `text-accent-text` → `text-overlap` (single-ink rule below 24px); doc comment updated. `icon.tsx` untouched.

### Verify (P1)

`bun run type-check && bun run lint && bun run test:run && bun run e2e`. Axe is the AA gate: `e2e/admin-smoke.spec.ts` loops every admin page; `e2e/public-discovery.spec.ts` sweeps `/` light **and dark**. Email test still passes (emails intentionally lag; its `#4b44a3` pin is the P3 tripwire). Playwright screenshot loop (pattern from this session's scratchpad scripts) over `/`, `/admin`, a collection list, an article, `/admin/access` × both themes; keyboard-tab pass for ring visibility; check the CodeMirror island recolor (it consumes `var(--color-*)` — free).

## P2 — Homepage recomposition + Stamp

**Hard contracts (must stay green, `src/components/marketing.test.tsx` + `e2e/public-discovery.spec.ts`):** all pinned copy strings, one h1, CTA names `Run your own mill`/`Connect an agent`, IDs `#run #connect #writing`, tab structure `surface-tab-*` + `[data-rm-tab][aria-selected=true]` scoped style, REST wire strings, axe light+dark.

- `src/components/marketing.tsx`: hero moves off the solid band onto cream — `rm-hero-field` replaced by canvas + `rm-halftone` pink dot layer; h1 gets `rm-overprint-title` (accent-text fill, 2px pink text-shadow); `HERO_CTA_PRIMARY` = blue pill + `rm-offset-shadow` (pink offset), secondary = hairline outline; the `outline-accent-fg` focus special-case and its comment are deleted (ink-on-stock hero → plain `outline-ring`). Demo panels → hairline job-ticket language with PROOF→SIGN-OFF workflow row (Stamp); quickstart → 3-coupon strip with dashed separators; trust bento → hairline tickets, audit rows use `<Stamp tone="refuse">DENIED</Stamp>`; footer CTA band = forced-dark `.rm-footer-band` (navy/cream/cyan literals, identical both themes); hero vignette PenNib rendered ≥40px with the two-pass overprint treatment (second copy `aria-hidden`, `mix-blend-multiply`).
- `src/tailwind.css`: delete `.rm-hero-field`/`rm-aurora-drift`; add `.rm-halftone`, `.rm-overprint-title`, `.rm-offset-shadow`, `.rm-footer-band`; keep `rm-stagger`/`rm-scroll-rise`; extend the reduced-motion block.
- `src/components/ui/stamp.tsx` (new, + barrel export): Badge-convention API — `tone: 'affirm' | 'refuse'` (affirm = working ink, refuse = pop), `tilt: 'none' | 'up' | 'down'` (±6deg, doc: max one tilt per cluster), `class` escape hatch, mono-caps `text-eyebrow`.

**Verify:** extend `marketing.test.tsx` (Stamp labels present), new `stamp.test.tsx`; `bun run e2e e2e/public-discovery.spec.ts`; screenshot loop `/` both themes + one `prefers-reduced-motion` pass.

## P3 — Stragglers

- `src/main.tsx` 404 (lines ~145-158) onto the token system (`bg-canvas`, `font-display`, `text-accent-text` link).
- `src/lib/email/templates.ts`: mirror the new **light** palette hex-for-hex (canvas/card/border/ink/muted/subtle; button fill `#0078bf` white-fg; link `#00639c`); heading style = SANS stack bold (no webfonts in email); update the header palette comment. `templates.test.ts:17` pin → `#0078bf`.
- Admin event states: swap denied rows in `src/routes/admin/activity/index.tsx` (+ access audit surfaces) to `Stamp tone="refuse"` — Badge stays for everything else.
- `src/templates/{article,changelog,portfolio,docs}.tsx` + `public-shell.tsx`: cheap hairline-language pass; structure pins (`rm-standfirst`, `data-share*`) untouched.

**Verify:** `bun run test:run`; `bun run e2e e2e/public-reading.spec.ts e2e/activity.spec.ts e2e/marketplace.spec.ts`; manual 404 in both themes.

## P4 — Docs

- `steering/DESIGN_SYSTEM.md` full direction rewrite (Overprint: stocks, working/pop/overlap inks, rationing rules, Stamp rules, hairline card language, Bricolage roles, hero contrast story). Keep the no-hex-in-docs contract.
- `steering/A11Y_STANDARDS.md` (pink-never-body-text rule), `steering/DATASTAR_PATTERNS.md` (accent worked examples ~lines 80-86), `steering/E2E_TESTING.md` + `steering/MEDIA_STANDARDS.md` (iris mentions), `CLAUDE.md` brand mentions.
- `docs/TECH_DECISIONS.md`: add **D43** (palette, theme-aware accent-fg, font-display rename, self-hosted Bricolage, email mirror policy, favicon violet; rejected: font CDN, keeping serif, pink-as-accent).

**Verify:** `grep -rn "iris\|Ink & Paper\|4b44a3\|font-serif" steering docs CLAUDE.md src` → nothing unexpected.

## Risks

1. **Pink AA**: `#ff48b0` is graphic-only; `pop-text` starts `#b8156e` (~5.5:1) — tune with the P0 script. No white-on-pink fills ever.
2. **Blue as text**: fill vs text token split already exists; `accent-text` light `#00639c`.
3. **Theme-aware `accent-fg`**: grep for `text-accent-fg` used off an accent fill before P1 merge (today only the hero uses it).
4. **Font payload**: variable latin subset ≤35KB, preload + swap; fallback to two static weights if over budget.
5. **Email drift**: intentional one-phase lag; the old-hex test pin is the tripwire.
6. **Radius/shadow ripple**: screenshot loop over admin pages catches clipping.

## Rollback

Each phase is one revertable PR; P1's blast radius concentrates in `src/tailwind.css` (revert restores the old system; the codemod would need `--font-display` aliased to the serif stack for a partial rollback). Per-PR preview Workers allow both-theme visual sign-off before the tag-driven release.
