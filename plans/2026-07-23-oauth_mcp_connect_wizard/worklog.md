# Worklog — 2026-07-23-oauth_mcp_connect_wizard

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-23 20:40 | plan approved | D48: OAuth 2.1 AS + connect wizard + device pairing + access index simplification; one PR; branch feat/agent-connect-oauth |
| 2026-07-23 20:55 | phase 1-2 done | schema+migration 0014 (hand-fixed cascade/CHECKs), lib/oauth (13 tests), oauth queries+service (21 tests), connectAgent (5 tests) |
| 2026-07-23 21:05 | phase 3 done | oauth routes (register/token/revoke/device-auth/authorize consent/device pairing), well-known aliases + CORS in main.tsx, /mcp 401 challenge + GET 405, 10-step flow integration test; mcp.test anonymous cases retargeted per D48 |
| 2026-07-23 21:20 | phase 4-5 done | connect wizard + cards + SecretReveal adoption; access index → directory (connect CTA, health lines, via-OAuth badge, forms demoted); agents.tsx deleted; e2e access spec rewritten |
