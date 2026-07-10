# Worklog — 2026-07-09-content_packs_marketplace_homepage_fixes

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-10 03:00 | Phase 1 done | focus ring (drop outline-ring), aria-selected scoped style + arrow keys on tabs, buildSearchText prose-only body (slug/media/relation/datetime excluded — widened from slug-only after finding med_/doc_/ISO pollution), snippet drift fixed, media-expansion doc bullet, DATASTAR_PATTERNS data-class gotcha captured. 361 unit + 9 e2e pass |
| 2026-07-10 03:30 | RE-PLAN | Phase 2: plan assumed bind lives in a definition JSON blob; collections table maps each concern to its own column, so bind needs storage — additive migration 0013 (bind_json text, 0012 template-column precedent). Plan.md updated |
| 2026-07-10 03:45 | Phase 2 done | parameterized resolver (wantHero/wantLead), bind escape hatch (schema+validation+storage via migration 0013), titleFieldOf text>slug + bind.title chain, wants capability flags gate share island/reading time on both routes, render-level drift test. 372 unit + reading e2e pass |
