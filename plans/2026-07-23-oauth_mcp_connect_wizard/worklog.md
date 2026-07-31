# Worklog — 2026-07-23-oauth_mcp_connect_wizard

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-23 20:40 | plan approved | D48: OAuth 2.1 AS + connect wizard + device pairing + access index simplification; one PR; branch feat/agent-connect-oauth |
| 2026-07-23 20:55 | phase 1-2 done | schema+migration 0014 (hand-fixed cascade/CHECKs), lib/oauth (13 tests), oauth queries+service (21 tests), connectAgent (5 tests) |
| 2026-07-23 21:05 | phase 3 done | oauth routes (register/token/revoke/device-auth/authorize consent/device pairing), well-known aliases + CORS in main.tsx, /mcp 401 challenge + GET 405, 10-step flow integration test; mcp.test anonymous cases retargeted per D48 |
| 2026-07-23 21:20 | phase 4-5 done | connect wizard + cards + SecretReveal adoption; access index → directory (connect CTA, health lines, via-OAuth badge, forms demoted); agents.tsx deleted; e2e access spec rewritten |
| 2026-07-23 21:35 | phase 6 docs | D48 in TECH_DECISIONS; ACCESS_CONTROL SEC-8 refinement; SECURITY_STANDARDS prefix map + challenge; API_AND_MCP oauth endpoints + raw-JSON exception; marketing quickstart; CLAUDE.md; plan status header |
| 2026-07-23 22:05 | phase 6 done | e2e green 74/74 after: dirty-D1 wipe, page.request cookie-clobber fix (register-before-login), CSP form-action interstitial (real bug — 303→200 meta-refresh handoff), per-file rate-limit buckets, strict-mode selectors; unit 522/522 |
| 2026-07-23 22:15 | PR opened | PR #36 feat/agent-connect-oauth — D48 complete, awaiting review/merge |
| 2026-07-24 05:10 | MERGED + DEPLOYED | PR #36 squash b19d025 → main; tag v1.10.0 CI+deploy green; live-probed: /mcp 401+WWW-Authenticate, GET 405, AS metadata + PRM aliases, DCR 201 (migration 0014 applied), existing rmk_ token works (REST 200, MCP 88 tools) |
