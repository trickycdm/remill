# Worklog — 2026-07-05-platform_knowledge_publishing_roadmap

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-05 18:20 | PLAN | Approved 3-track roadmap (Access / relational data+graph / render+publish+share); branch feature/platform-knowledge-roadmap |
| 2026-07-05 18:35 | A1 done | principals.subtype (person/service/agent) + backfill migration 0004; personaOf helper; createAgent takes subtype (+SEC-8 guard); Access screen grouped People/Services/Agents; docs+unit+e2e. 0 type/0 lint/175 unit/20 e2e |
| 2026-07-05 18:50 | A2 done | invite/create human: createUserPrincipal + createUser service; invite_tokens table (migration 0005), single-use/expiring set-password links; stubbed EmailTransport (PII-safe); /admin/access/users route + Add-person form + public /auth/set-password/[token]. docs+unit+e2e. 0 type/0 lint/178 unit/22 e2e |
| 2026-07-05 19:00 | A3a done | custom-role CRUD screen /admin/access/roles; per-collection token scoping (collection × action checkboxes). e2e. commit b868d59 |
| 2026-07-05 19:10 | A3 done | item-grant Share surface: listGrantsForDocument query + listItemGrants service; admin Share panel on doc edit (managers only) + share route; REST /grants (GET/POST/DELETE); MCP share_&lt;slug&gt; tool. docs+unit+e2e. 0 type/0 lint/179 unit/24 e2e |
| 2026-07-05 19:25 | A4 done | /admin/access/matrix: effective-permission matrix (principal × collection) + all item grants + token scopes; listAllGrants query + listAllItemGrants service; linked from Access page. e2e + axe. |
| 2026-07-05 19:25 | FLAKE FIX | e2e axe sweep occasionally timed out under the longer serial suite (vite-dev on-demand compile). Wait on #main-content instead of networkidle; set playwright retries:1 locally (matches CI). Pages are axe-clean in isolation — not a real violation. |
