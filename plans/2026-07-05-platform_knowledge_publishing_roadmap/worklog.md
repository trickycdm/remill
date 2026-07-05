# Worklog — 2026-07-05-platform_knowledge_publishing_roadmap

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-07-05 18:20 | PLAN | Approved 3-track roadmap (Access / relational data+graph / render+publish+share); branch feature/platform-knowledge-roadmap |
| 2026-07-05 18:35 | A1 done | principals.subtype (person/service/agent) + backfill migration 0004; personaOf helper; createAgent takes subtype (+SEC-8 guard); Access screen grouped People/Services/Agents; docs+unit+e2e. 0 type/0 lint/175 unit/20 e2e |
| 2026-07-05 18:50 | A2 done | invite/create human: createUserPrincipal + createUser service; invite_tokens table (migration 0005), single-use/expiring set-password links; stubbed EmailTransport (PII-safe); /admin/access/users route + Add-person form + public /auth/set-password/[token]. docs+unit+e2e. 0 type/0 lint/178 unit/22 e2e |
