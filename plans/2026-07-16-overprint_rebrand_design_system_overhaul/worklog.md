# Worklog — 2026-07-16-overprint_rebrand_design_system_overhaul

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-16 16:22 | PLAN | Plan approved: 5-phase Overprint rebrand (P0 kit, P1 tokens+font, P2 homepage+Stamp, P3 stragglers, P4 docs) |
| 2026-07-16 16:26 | P0 | Font vendored + instanced (wght 500-800, latin-1, 30.3KB) into public/fonts; scripts/check-contrast.mjs added; light pop tuned #ff48b0 -> #ef2c9b (3.38:1); all 56 AA pairings pass |
| 2026-07-16 17:05 | P1 | Tokens -> Overprint (theme-aware accent-fg), Bricolage @font-face+preload, font-serif->font-display codemod (22 files), favicon+wordmark -> overlap violet, theme-color metas |
| 2026-07-16 17:05 | P1-FIX | ink-subtle retuned for hovered-row AA (axe reads hover state); found Playwright 1.61.1 dropping use.reducedMotion from default fixtures — worked around in e2e/helpers/auth.ts |
| 2026-07-16 17:06 | P1-VERIFY | 67/67 e2e green on clean state (incl. all axe sweeps + dark), 404/404 unit, contrast audit all-pass, both-theme screenshots reviewed |
| 2026-07-16 17:38 | P2 | Homepage recomposed to Pressrun: on-stock hero (overprint title, halftone, second-pass backing, nib chop), job ticket w/ PROOF->SIGN-OFF stamps, stamped audit rows, coupon quickstart, theme-fixed footer band; new ui/stamp.tsx (affirm/event/refuse) |
| 2026-07-16 17:38 | P2-FIX | Footer wordmark: class override lost same-property cascade to text-ink; fixed with scoped .rm-footer-band rules |
| 2026-07-16 17:39 | P2-VERIFY | 67/67 e2e clean-state, 409/409 unit (5 new), both-theme screenshots match the mock |
| 2026-07-16 17:58 | P3 | 404 on-system (overprint 404, token colors); email palette mirrored to Overprint light (+ test pin -> #0078bf); deny rows stamped at 3 audit sites (allow stays Badge); reading templates: no churn needed post-P1 (verified via public-reading e2e + screenshots) |
| 2026-07-16 17:59 | P3-VERIFY | 67/67 e2e clean-state, 409/409 unit |
