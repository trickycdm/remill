# Worklog — 2026-07-16-overprint_rebrand_design_system_overhaul

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-16 16:22 | PLAN | Plan approved: 5-phase Overprint rebrand (P0 kit, P1 tokens+font, P2 homepage+Stamp, P3 stragglers, P4 docs) |
| 2026-07-16 16:26 | P0 | Font vendored + instanced (wght 500-800, latin-1, 30.3KB) into public/fonts; scripts/check-contrast.mjs added; light pop tuned #ff48b0 -> #ef2c9b (3.38:1); all 56 AA pairings pass |
| 2026-07-16 17:05 | P1 | Tokens -> Overprint (theme-aware accent-fg), Bricolage @font-face+preload, font-serif->font-display codemod (22 files), favicon+wordmark -> overlap violet, theme-color metas |
| 2026-07-16 17:05 | P1-FIX | ink-subtle retuned for hovered-row AA (axe reads hover state); found Playwright 1.61.1 dropping use.reducedMotion from default fixtures — worked around in e2e/helpers/auth.ts |
| 2026-07-16 17:06 | P1-VERIFY | 67/67 e2e green on clean state (incl. all axe sweeps + dark), 404/404 unit, contrast audit all-pass, both-theme screenshots reviewed |
