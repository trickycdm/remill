# Worklog — 2026-11-14-mcp_fixed_collection_document_tools

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-11-14 06:40 | plan approved | D65: fixed 33-tool MCP surface taking `collection`; branch feat/mcp-collection-tools from origin/main (9a170f9) |
| 2026-11-14 06:47 | step 1 done | gating fixture + golden of per-collection tools/list for 10 principals (admin sees 102 tools over 7 collections); tests need Node 22 (better-sqlite3 ABI) — nvm v22.14.0 |
| 2026-11-14 07:00 | steps 2–3 done | tools.ts: 18 document-tool specs (permitted + needs), resolveCollection, describe_collection, list_collections actions, validation hint; handler: instructions, TOOL_RENAMED redirect, McpToolError extras |
| 2026-11-14 07:05 | decision | feature-gate refusal (no lifecycle / not public / no html-markdown field) is BAD_REQUEST with the reason, not FORBIDDEN+missing — `missing` would name a permission the caller already holds |
| 2026-11-14 07:10 | steps 4–5 done | ported mcp.test, mcp-parity, oauth-flow, api-share-link, pages-collection; new collection-tools.test.ts (gating equivalence vs golden — verified by 3 mutations); removed newTools, de-dupe, TOOL_RESERVED_COLLECTION_SLUGS; 931/931 pass |
| 2026-11-14 07:25 | step 6 done | homepage copy + e2e assertion (public-discovery 7/7 incl. axe); D65 row; API_AND_MCP_STANDARDS MCP section rewritten; CLAUDE/README/PROJECT_BRIEF/SCHEMA_ENGINE/ACCESS_CONTROL/SECURITY_STANDARDS/CODING_CONVENTIONS + ~12 source comments swept; tools/list_changed backlog item removed |
| 2026-11-14 07:30 | verified | live JSON-RPC walkthrough on the local preview (workerd): list → create_collection → create_document same session → stale update 409 → publish → share link → retired-name redirect; test collection + agent deleted afterwards |
| 2026-11-14 07:32 | measured | fixture tools/list: admin 102/76 KB → 33/45 KB, editor 91/44 KB → 27/16 KB; 26 KB of the admin remainder is D64's definition schema ×2 → BACKLOG |
| 2026-11-14 07:40 | PR opened | #61; build/lint/type-check/test pass in CI |
| 2026-11-14 07:42 | blocker hit | preview deploy failed: account at D1 database cap. Cause: PRs #53–#57 (closed unmerged 2026-10-04) had previews deployed and no cleanup run ever fired |
| 2026-11-14 07:50 | blocker cleared | Col approved; ran preview-cleanup.yml for 53–57 (each deleted its Worker + D1); re-ran #61 preview → deployed, all checks green |
| 2026-11-14 07:55 | verified (partial) | preview serves the new bundle: homepage shows create_document copy, /mcp answers the 401 OAuth challenge. Authenticated tool flow NOT testable on a preview — its D1 has no admin user by design; covered locally (workerd walkthrough) and to be confirmed on production after release |
