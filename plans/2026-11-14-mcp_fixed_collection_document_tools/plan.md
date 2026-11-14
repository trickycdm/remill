# MCP: a fixed set of document tools that take a `collection` (D65)

**Status:** shipped in v1.20.0 · 2026-11-14 (PR #61; D65 + D66)

## Bottom line

Replace the per-collection generated MCP tools (`create_articles`, `list_tasks`, … 13–19 per
collection) with **one fixed set of 33 tools** that take a `collection` argument, plus a
`describe_collection` lookup tool that returns what the per-collection tools used to carry in
their schemas. The tool count stops growing with the number of collections.

This gives MCP the shape REST already has: fixed verbs, a collection parameter
(`/api/c/:collection/...`), and a generated schema document (OpenAPI there, `describe_collection`
here).

**Access rules do not change.** The condition that decides whether `publish_articles` is listed
today becomes the condition that decides whether `publish_document` accepts
`collection: "articles"`. A test compares the two against a snapshot taken before the rewrite.

## Context

- **The problem.** The live server lists about 160 tools for 12 collections, and every new
  collection adds 13–19 more. Clients that load every tool definition pay for all of them in
  every conversation, and tool selection degrades as near-identical names pile up.
- **Three other defects come from the same design** and go away with it:
  1. *A new collection is unusable until the client reconnects.* Clients cache the tool list and
     remill cannot push a "tools changed" notification, so after `create_collection` the agent
     cannot call `create_<newslug>`. Main works around this with a `newTools` + "please
     reconnect" note (`newToolsSince` in `src/mcp/tools.ts`) and a backlog item.
  2. *Slug/tool name collisions.* A collection with slug `page` would generate `publish_page`
     and shadow the static tool. Main refuses that slug on create and de-duplicates the tool
     list by name to cope.
  3. *Argument collisions.* `update_<slug>` mixes control arguments (`expectedRevision`,
     `resolves`) with document fields at one level, so a field with either name is silently
     stripped and can never be written over MCP.
- **This reverses a logged decision.** D64 (agents can manage schema, shipped v1.19.0) lists "a
  generic `create_document(collection, …)` tool" under rejected alternatives, reason:
  "duplicates the typed per-collection tools". The new evidence is the tool count at 12
  collections. D65 supersedes that line by *replacing* the typed tools, not adding beside them.

## Base branch

The current checkout (`feat/editor-page-rework`) is already merged and is 8 commits behind
`origin/main`, which holds the newer MCP code (`publish_page`, review links, the generated
definition schema). Work starts on a new branch `feat/mcp-collection-tools` cut from
`origin/main`. All file references below are to `origin/main`.

## Design

### The tool surface (33 tools, constant)

**Unchanged static tools (13):** `whoami`, `list_templates`, `list_packs`, `create_collection`,
`update_collection`, `install_pack`, `list_teams`, `list_audit`, `publish_page`, `upload_media`,
`list_media`, `get_media_url`, `poll_events`.

**Discovery (2):**

| Tool | Change |
| --- | --- |
| `list_collections` | Returns the existing public projection for every caller (`slug`, `name`, `shape`, fields as key/type/label/required) plus **`actions`: what the caller may do in that collection**. Schema managers no longer get every full definition here (that would be the largest payload in the new flow); it moves to `describe_collection`. REST `/api/collections` is unchanged. |
| `describe_collection {collection}` | **New.** The definition (full for schema managers, public projection otherwise), available `render` names, whether status / visibility / comments apply, and the caller's `actions`. Callers who could `create` or `update` there also get the JSON Schema for `data` (required fields, select options, length limits, relation targets) — the same people who see it in `create_<slug>` today. Callers who can `read` get the filterable/sortable field keys. |

**Document tools (18), each with a required `collection`:**

| New tool | Replaces | Gate (same condition as today) |
| --- | --- | --- |
| `list_documents` | `list_<slug>` | read |
| `search_documents` | `search_<slug>` | read |
| `get_document` (`render`, `budget`) | `get_<slug>` | read (`render: "review"` keeps its extra check) |
| `get_backlinks` | `backlinks_<slug>` | read |
| `list_revisions` | `revisions_<slug>` | read |
| `create_document {collection, data}` | `create_<slug>` | create |
| `update_document {collection, id, expectedRevision, data, resolves?}` | `update_<slug>` | update |
| `restore_revision` | `restore_<slug>` | update |
| `delete_document` | `delete_<slug>` | delete |
| `publish_document` | `publish_<slug>` | publish + collection has a lifecycle |
| `schedule_document` | `schedule_<slug>` | publish + lifecycle |
| `set_visibility` | `visibility_<slug>` | publish + `publicRead` |
| `share_document` | `share_<slug>` | manage_access |
| `create_share_link` | `share_link_<slug>` | share_link |
| `list_comments` | `comments_<slug>` | comment or update, on a collection with html/markdown fields |
| `add_comment` | `comment_<slug>` | comment, same |
| `reply_comment` | `reply_comment_<slug>` | comment, same |
| `resolve_comment` | `resolve_comment_<slug>` | comment or update, same |

Document fields move under `data` on create/update, which removes the argument collision.

Choices made, and why:

- **`collection` is required everywhere, including by-id tools and search.** Document ids are
  globally unique, but resolving an id to find its collection is an existence probe before
  authorization. REST search is per-collection too.
- **`collection` is a plain string, not an `enum`.** An enum goes stale in a cached tool list and
  brings back the reconnect problem.
- **One tool per verb, not fewer.** Merging (say) the four comment tools behind an `action`
  argument would erase their different permission gates and make the schemas conditional.
- **No typed tools for a "pinned" few.** That keeps all three defects alive for those collections.
- **The built-in `media` collection stays excluded**, exactly as the current loop skips it; it
  has its own tools.

### One condition, used twice

Each document tool is declared once, as plain data inside `buildToolsForPrincipal` (so it closes
over the caller's permissions):

```ts
interface CollectionToolSpec {
  name: string;
  description: string;
  inputSchema: JSONSchema;                       // static
  action: Action;                                // for the structured denial
  applies(def: CollectionDefinition): boolean;   // today's emit condition, moved verbatim
  run(def: CollectionDefinition, args: Record<string, unknown>): Promise<unknown>;
}
```

- **Listing:** a tool is listed when `applies` is true for at least one collection. An agent with
  no `publish` anywhere still never sees `publish_document`.
- **Calling:** `resolveCollection(spec, args.collection)` runs before `run`:
  1. Collection missing, `media`, or one the caller has no way to know about (a private
     collection where no tool applies for them) → **one uniform error**: `FORBIDDEN`, "Unknown or
     unavailable collection", plus `available` (the slugs this tool applies to for this caller).
     Hidden and nonexistent are byte-identical. This check matters: several write services look
     the collection up *before* authorizing and would otherwise answer `NOT_FOUND` vs `FORBIDDEN`.
  2. Collection known, but `applies` is false → `FORBIDDEN` with `missing: {action, collection}`
     (the structured denial the steering docs require), plus `available`.
  3. Otherwise `run`. The service's `authorize()` remains the authority on every call, as now.
- `available` is computed from the same `applies`, so it can only name slugs whose
  `<verb>_<slug>` tool is listed for that caller today.

**Known gap, recorded in D65:** a refusal at step 1 or 2 happens before the service, so it writes
no audit row — the same as today's "unknown tool" refusal, but more likely to occur now that the
tool itself is visible. `list_collections.actions` and the `available` list are there to make it
rare.

### Keeping agents accurate without typed schemas

The typed per-collection `create`/`update` schema is the one real thing given up. The tool
schema was only ever advisory — the real validator is `whitelistAndValidate` in the documents
service — so three things replace it:

1. `describe_collection` returns the same JSON Schema on demand.
2. When `create_document` / `update_document` fail validation, the tool adds a `hint` listing
   the declared field keys. Done in the MCP layer after the permission check, so it reaches only
   callers already entitled to the schema.
3. `initialize` gains a short static `instructions` string: call `list_collections` first, pass
   the slug as `collection`, call `describe_collection` before writing.

### Old tool names

A call to a retired name returns an error naming the replacement — `create_articles` →
"use `create_document` with `collection: "articles"`" — so an agent or script following stale
instructions corrects itself on the next call. The mapping is purely textual (slugs cannot
contain `_`, so split at the last underscore) and never checks whether the collection exists, so
it reveals nothing. Old names are not listed and not executed.

_Alternative if you would rather not touch your skills straight away: silently execute old names
for one release. More code and a second surface to test; not recommended._

### Cleanup this makes possible

- Delete `newToolsSince` and the `newTools` / reconnect note; `create_collection` and
  `install_pack` results say the collection is usable immediately.
- Delete the tool-list de-duplication, `TOOL_RESERVED_COLLECTION_SLUGS` and the `page` slug
  refusal (a D62 supporting rule).
- Remove the "push tools/list_changed" backlog item.

## Files

- `src/mcp/tools.ts` — the rewrite: spec table, `resolveCollection`, `describe_collection`,
  `actions` on `list_collections`. Reused as-is: `couldDo` (still exported for
  `src/mcp/prompts.ts`), `docInputSchema`, `filtersFromArgs`, `stringList`, `mcpText`,
  `rendersFor`, `hasLifecycle`, `comments.hasAnnotatableFields`, and every service call.
- `src/mcp/handler.ts` — `instructions` on `initialize`; retired-name redirect in the
  unknown-tool branch.
- `src/services/collections/index.ts` — export `toPublicView`; drop the `page` slug rule
  (~line 354); fix the generated-schema text at ~line 92 that says a slug "names the generated
  tools"; `update_collection`'s "read it first with list_collections" becomes
  `describe_collection`.
- `src/config/constants.ts` — delete `TOOL_RESERVED_COLLECTION_SLUGS`.
- Tests — about 100 hard-coded name literals and no name-building helper:
  `src/mcp/mcp.test.ts` (~73), `src/mcp/mcp-parity.test.ts` (~20),
  `src/routes/oauth/oauth-flow.test.ts`, `src/services/sharing/api-share-link.test.ts`. Port
  through one small `call(token, tool, args)` helper.
- Public homepage — `src/components/marketing.tsx` shows `create_essays`, `publish_essays`, an
  `EXAMPLE_TOOLS` list and "Every collection the agent can see becomes a set of tools";
  `e2e/public-discovery.spec.ts:209` asserts `create_essays`. Rewrite the copy to the new shape
  and update the assertion.
- Docs (about 55 references): `steering/API_AND_MCP_STANDARDS.md` (tool list, naming rule,
  "capability discovery is permission discovery", and the "no tool-framework indirection" line —
  the spec table is plain data in the same module), `steering/SCHEMA_ENGINE.md` (surface 6
  wording), `steering/ACCESS_CONTROL.md`, `steering/SECURITY_STANDARDS.md`, `CLAUDE.md`,
  `README.md`, `docs/PROJECT_BRIEF.md`, `plans/BACKLOG.md`. `docs/TECH_DECISIONS.md` gets a new
  D65 row only; its own rule is "never rewrite history in place", so older rows keep their tool
  names.
- About ten stale source comments naming `<verb>_<slug>`.

Checked and not affected: nothing outside `src/mcp/` dispatches on a tool name; the audit log
stores surface/action/collection, never the tool; OpenAPI is REST-only; connect snippets, the
connect wizard, the OAuth consent screen, emails and the content packs name no tools; MCP
prompts (D44) share only `couldDo`; token scope masks are enforced inside `authorize()`.

## Steps (one PR, commits in this order)

0. Branch from `origin/main`. The plan folder
   `plans/2026-11-14-mcp_fixed_collection_document_tools/` (plan + worklog) already exists; log
   each step there.
1. **Snapshot first.** Before touching `tools.ts`, add a fixture test and commit a golden file
   of `tools/list` names per principal. Principals: admin, editor on `*`, editor on one
   collection, author, token-masked reader, create-only mask on a private collection, editor
   masked without `comment`. Collections: with lifecycle, without, private, `publicRead`,
   `media`, `pages`.
2. `tools.ts`: spec table + `resolveCollection`; port the 18 tools; remove the loop; add
   `describe_collection`, `actions`, the validation `hint`.
3. `handler.ts`: `instructions`, retired-name redirect.
4. Port the existing suites; add the new tests below.
5. Remove the dead workarounds (newTools, de-dupe, reserved slug).
6. Homepage copy + its e2e assertion; docs + D65 + backlog; stale comments.
7. Verify (below), open the PR, exercise the preview Worker.

## Verification

- `bun run type-check && bun run lint && bun run test:run`, plus `bun run e2e` for the homepage.
- New unit tests:
  - **Gating equivalence:** for every (principal, collection, tool) in the step-1 fixture,
    `resolveCollection` passes exactly when `<oldverb>_<slug>` is in the golden file.
  - **Invariance:** `tools/list` names are identical before and after `create_collection`.
  - A newly created collection is writable in the same session with no re-list.
  - A hidden private collection and a nonexistent slug give byte-identical errors, across all 18
    tools, `describe_collection`, and retired names.
  - `media` is refused by every document tool.
  - A field named `resolves` round-trips through `create_document` / `update_document`.
  - A validation failure carries the declared-fields `hint`.
- Local end-to-end over JSON-RPC against `bun run dev`: `list_collections` →
  `describe_collection` → `create_document` → `update_document` (stale revision → 409) →
  `publish_document` → `create_share_link`; then `create_collection` followed at once by
  `create_document` in it.
- On the PR preview Worker: connect Claude Code by URL, confirm the tool count (33 for an admin
  token, down from about 160), and run the same flow.

## After release (outside this repo)

- Reconnect clients; update the `remill-mcp-connection` memory note.
- Update the `hopper` skill in the tricky-skills plugin repo — its SKILL.md tells the agent to
  call `list_<slug>` / `create_<slug>` / `update_<slug>` / `search_<slug>`. (`founders-report`
  uses `publish_page`, which does not change.)
- Check Claude Code permission allowlists for rules naming old `mcp__remill__<verb>_<slug>`
  tools.

## Revision Log

- 2026-11-14: Three refinements made while building, none changing the approved shape.
  (1) A known collection that lacks the *feature* a tool needs (no lifecycle, not public, no
  html/markdown field) is refused `BAD_REQUEST` naming the feature, not `FORBIDDEN` + `missing` —
  `missing` would name a permission the caller already holds. A missing *permission* still gets
  `FORBIDDEN` + `missing`. (2) A retired tool name answers with its own code, `TOOL_RENAMED`,
  plus `replacedBy`. (3) `describe_collection` also returns `tools`: the document tools that
  apply to that collection for the caller — the direct replacement for reading a per-collection
  tool list.
- 2026-11-14: Measured result on the 7-collection test fixture: admin `tools/list` 102 tools /
  76 KB → 33 / 45 KB; editor 91 / 44 KB → 27 / 16 KB. Found while measuring, out of scope and
  backlogged: 26 KB of the admin's remaining 45 KB is D64's collection-definition schema, sent
  by both `create_collection` and `update_collection`.
- 2026-11-14: After the first review Col asked for the four follow-ups. Added D66 to the same
  PR (the collection-definition schema rides on `create_collection` only; a 34 KB budget test),
  which took the admin's list from 45 KB to 32 KB. Shipped as v1.20.0. On the live install the
  owner's agent (editor role, 13 collections) now lists 27 tools / 17 KB, down from about 160.
