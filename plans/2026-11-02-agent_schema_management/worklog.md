# Worklog — agent schema management (D64)

| When | Action | Detail |
| --- | --- | --- |
| 2026-11-02 | investigate | create_collection exists but is gated on manage_schema; OAuth consent excludes admin, no other role has it |
| 2026-11-02 | plan | builder role + generated definition JSON Schema + new-tools note |
| 2026-11-02 | done | builder role: policy, seed.sql, migration 0022 + test, session role enum, admin nav |
| 2026-11-02 | done | generated definition JSON Schema (field summaries), MCP create/update schema + newTools note; 916 unit tests green |
| 2026-11-02 | RE-PLAN | local db:migrate failed: D1 caps compound SELECT — 0022 split into per-row INSERTs |
| 2026-11-02 | done | createCollection forces protected:false (+test); docs: D64, ACCESS_CONTROL, API_AND_MCP, CLAUDE.md, BACKLOG |
| 2026-11-02 | verify | e2e oauth-consent + admin-schema-access: 13/14 pass; invite-link failure is local siteUrl=remill.me (env), unrelated |
| 2026-11-02 | shipped | 4d929ea on main; tag v1.19.0 deployed, prod migration 0022 applied ✅ |
