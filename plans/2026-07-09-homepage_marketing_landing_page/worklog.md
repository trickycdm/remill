# Worklog — 2026-07-09-homepage_marketing_landing_page

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-09 08:40 | skill installed | tasteskill v2 via `npx skills add Leonxlnx/taste-skill` → .agents/skills/design-taste-frontend (symlinked .claude/skills) |
| 2026-07-09 08:42 | plan approved | design read declared, dials 7/5/3, 6 sections at `/`, discovery index folds in, agent quickstart CTA |
| 2026-07-09 08:45 | branch | feat/marketing-homepage |
| 2026-07-09 08:47 | assets | public/favicon.svg (PenNib, dark-aware) + layouts.tsx icon link; tailwind.css: --text-display-lg token, rm-scroll-rise (@supports animation-timeline) |
| 2026-07-09 08:48 | icons | DatabaseIcon/Braces/Bot added to icon.tsx (Lucide paste, sanctioned approach) |
| 2026-07-09 08:49 | components | marketing-shell.tsx (full-bleed chrome) + marketing.tsx (6 sections); index.tsx rewritten, /admin redirect removed |
| 2026-07-09 08:50 | tests | marketing.test.tsx (200 on empty install, head props); e2e homepage marketing test added (h1 count, CTA anchors, dark-mode axe) |
| 2026-07-09 08:52 | verified | type-check 0, lint 0, 336/336 unit tests; tasteskill pre-flight: 0 em-dashes in copy, 2 eyebrows (budget) |
| 2026-07-09 09:00 | e2e fix | code panels need tabindex/role=region/aria-label (WCAG 2.1.1, axe); manual browser contexts need explicit reducedMotion:'reduce' so axe reads resting colors |
| 2026-07-09 09:05 | e2e green | full suite 60 passed from clean D1 (stale .wrangler/state caused the earlier admin-schema flake) |
| 2026-07-09 09:04 | screenshots | light + dark full-page verified; both axe sweeps clean; head props confirmed via curl |
| 2026-07-09 09:10 | PR | #8 opened; CI (Build/Lint/Type-check/Test) pass, Deploy PR preview pass, prod deploy skipped (tag-driven) |
| 2026-07-09 09:15 | preview verified | https://remill-pr-8.soft-frost-24fb.workers.dev on real CF: favicon 200, MCP URL resolves to preview origin, strict public CSP |
