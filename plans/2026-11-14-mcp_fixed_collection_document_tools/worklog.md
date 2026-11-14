# Worklog — 2026-11-14-mcp_fixed_collection_document_tools

| Timestamp | Action | Detail |
|-----------|--------|--------|
| 2026-11-14 06:40 | plan approved | D65: fixed 33-tool MCP surface taking `collection`; branch feat/mcp-collection-tools from origin/main (9a170f9) |
| 2026-11-14 06:47 | step 1 done | gating fixture + golden of per-collection tools/list for 10 principals (admin sees 102 tools over 7 collections); tests need Node 22 (better-sqlite3 ABI) — nvm v22.14.0 |
| 2026-11-14 07:00 | steps 2–3 done | tools.ts: 18 document-tool specs (permitted + needs), resolveCollection, describe_collection, list_collections actions, validation hint; handler: instructions, TOOL_RENAMED redirect, McpToolError extras |
| 2026-11-14 07:05 | decision | feature-gate refusal (no lifecycle / not public / no html-markdown field) is BAD_REQUEST with the reason, not FORBIDDEN+missing — `missing` would name a permission the caller already holds |
| 2026-11-14 07:10 | steps 4–5 done | ported mcp.test, mcp-parity, oauth-flow, api-share-link, pages-collection; new collection-tools.test.ts (gating equivalence vs golden — verified by 3 mutations); removed newTools, de-dupe, TOOL_RESERVED_COLLECTION_SLUGS; 931/931 pass |
