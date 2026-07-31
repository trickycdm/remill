# Worklog — 2026-07-09-deploy_remill_org_production_cloudflare

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-09 06:20 | plan approved | Chrome-driven linking + apex-only domain chosen |
| 2026-07-09 06:24 | R2 activated | $0 subscription, PayPal on file, user pre-approved |
| 2026-07-09 06:25 | token + secrets | remill-github-actions token verified; 4 repo secrets set via gh |
| 2026-07-09 06:29 | PR #1 merged | setup-production.yml, prod wrangler config, ci secret push |
| 2026-07-09 06:32 | provision run 1 | D1/KV/R2 created; D1 landed WNAM (US runner) |
| 2026-07-09 06:33 | RE-PLAN | recreate empty D1 in WEUR (user approved); merges session-authorized |
| 2026-07-09 06:37 | PR #2 merged | KV ids + guarded WEUR recreate step |
| 2026-07-09 06:39 | provision run 2 | D1 recreated in WEUR: 6baea339-… |
| 2026-07-09 06:40 | PR #3 merged | production D1 id committed |
| 2026-07-09 06:41 | finalize 1 FAILED | own guard tripped on preview's by-design placeholder |
| 2026-07-09 06:42 | PR #4 merged | guard narrowed to top-level section |
| 2026-07-09 06:43 | finalize 2 FAILED | schedules PUT: zombie previews pr-1..4 held 8/5 crons |
| 2026-07-09 06:47 | RE-PLAN | cleanup race found (delete before deploy finishes, error swallowed) |
| 2026-07-09 06:50 | PR #5 merged | race-aware teardown + cron-free previews; pr-1..4 deleted |
| 2026-07-09 06:52 | RE-PLAN | pr-5 preview STOLE remill.org (routes inherit) → explicit empty routes |
| 2026-07-09 06:53 | PR #6 merged | preview routes: []; pr-5 torn down, domain freed |
| 2026-07-09 06:55 | finalize 3 GREEN | migrate+seed+deploy+secrets+admin+smoke all pass |
| 2026-07-09 06:57 | verified | 200s on /, robots, rss, sitemap; live login POST OK; crons registered |
| 2026-07-09 07:05 | COMPLETE | plan wrapped up |
