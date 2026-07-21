# Collab pack — remill as a multi-model context bus (v1)

> **STATUS: COMPLETE — 2026-07-21.** All 8 steps implemented and verified: 466/466 unit
> tests, type-check + lint clean, and the full manual MCP flow driven against local dev
> (install → task → 422 beat → warp → reviewer/implementer renders → share-link status
> page → privacy/lifecycle/events checks). One documented v1 behavior: the ANONYMOUS
> share-link status page shows task content only — backlink groups are access-scoped to
> the link identity, and warps/decisions are private (invisible-never-a-leak, by design).
> Uncommitted; awaiting commit/PR decision.

## Context

Multi-model coding workflows (Fable in Claude Code → Codex reviewing → any third agent
joining later) have no structured handover layer — today it's copy-paste, scratch files, or
repo worklogs entangled with branches. remill already has the primitives (MCP + per-agent
tokens, schema-as-data validation, private collections D46, events D33, share links D26,
packs D42, templates D41). v1 delivers the **collab content pack** — `tasks` / `warps` /
`decisions` collections whose required fields *are* the handover protocol — plus
**text renders** (role + token-budget tailored views of a warp; pure templates, no LLM)
and a **status share page** derived from the task record. Reference mock: claude.ai
artifact "remill collab flow — one task, three models" (2026-07-20).

**Non-goals (explicit, goes in D47):** orchestration ("the bus, never the brain"),
webhooks (v1 is human-relayed; `poll_events` covers catch-up), vendor personas (tailoring
is role + budget only).

## Design decisions (settled)

- `tasks.status` → **`stage`** — `status` is in `RESERVED_FIELD_KEYS`
  (`src/config/constants.ts:28-32`); validateDefinition would reject it.
- `open_questions` on warps = **markdown, required** (tags caps items at 100 chars; prose
  questions need markdown; FTS-searchable).
- **Task carries the current rollup** (user-confirmed): optional `open_questions` markdown
  on `tasks` — updated at warp-out by convention; powers the status page's "Needs a human"
  panel. Warps stay historical snapshots. Templates stay pure; zero core changes.
- MCP render return = **text passthrough sentinel** (`McpTextResult` + guard in
  `src/mcp/tools.ts`; one branch in `handler.ts` `tools/call`) — JSON-quoting markdown
  would escape newlines and bloat the very tokens a budget exists to save.
- Warps get a required **`title`** text field first — otherwise `titleFieldOf` makes
  `next_action` the display title in lists/search/backlinks.
- Render errors **throw `InputValidationError`** (422) listing available render names —
  both doors map it with zero per-surface branching. Unknown render is validated against
  code metadata *before* the doc read (no oracle).
- Render rides the existing `read` action — no new action, no new gates. All three
  collections: `access: { private: true }`, `workflow: { lifecycle: 'none' }` (born
  published; record-like working data).
- First **multi-collection pack**; collections select different templates
  (tasks→`status`, warps→`warp`, decisions→`docs` reuse). `packs.test.ts`'s
  one-template-per-pack assertion is deliberately relaxed (noted in D47).
  `Pack.template` (display-only) = `'warp'`.

## Implementation steps

### 1. Templates (closed registries) — **DONE**
- `src/templates/keys.ts` — `TEMPLATE_KEYS` += `'warp'`, `'status'` (build fails until
  registry catches up — intended).
- **New `src/templates/warp.tsx`** — `wants: {}`; model on `prompt.tsx`/`docs.tsx` with
  `resolveConventionLayout(def, { wantHero:false, wantLead:false })`. Header: title +
  `written_as` role badge + `task` relation line (via `FieldView` with
  `doc.relations?.task`). Highlighted "Next action" panel; `state` and `open_questions`
  as labelled sections; `decisions` relation + `code` json in meta; `Backlinks`
  (`dedupeBacklinks`) at the bottom. Key doubles as the semantic marker for text renders
  (mirrors `def.template === 'prompt'`, `src/mcp/prompts.ts:52-54`).
- **New `src/templates/status.tsx`** — `wants: {}`; plain-language task page for
  `/s/:token`: title, `stage` as `Stamp` (option *label*, not value), goal prose,
  **"Needs a human" panel from `tasks.open_questions`** (omit when empty), repo/branch
  meta rows, then backlinks grouped by source collection (generic, no hard-coded slugs;
  check `src/components/backlinks.tsx` for reuse first), titled + dated, newest first.
- `src/templates/registry.ts` — register both.

### 2. The pack — `src/templates/packs.ts` — **DONE**
- `PACK_KEYS` += `'collab'`; three scaffolds + `PACKS.collab` entry:
  - **tasks** (template `status`): title (text, req, index, showInList), goal (markdown,
    req), repo (text), branch (text), stage (select exploring/building/in-review/
    changes-requested/done, index, showInList), open_questions (markdown, optional,
    help: "Current unresolved questions needing a human — update when you warp out.").
  - **decisions** (template `docs`): title (text, req, index, showInList), body
    (markdown), task (relation→tasks, index), verdict (select note/recommended/blocking,
    index).
  - **warps** (template `warp`): title (text, req, index, showInList), task
    (relation→tasks, req, index), written_as (select implementer/reviewer/planner),
    state (markdown, req), decisions (relation→decisions, multiple, index),
    open_questions (markdown, req), next_action (text, req), code (json — branch/head/
    diffstat pointers).
- Relax `src/templates/packs.test.ts`: pack.template resolves; each collection template
  (when set) resolves; ≥1 collection selects pack.template.
- Zero service work — installPack/Marketplace/MCP tools/events all derive from registries.

### 3. Text renders — new pure module `src/templates/renders.ts` — **DONE**
- Import-light (type-only imports of def/doc/backlink types; values only from
  `def-helpers`, `errors`, `keys`, `constants`). No JSX, no services values.
- `TextRender = { description, needsBacklinks?, render(input) => string }`;
  `TEXT_RENDERS: Partial<Record<TemplateKey, Record<string, TextRender>>>` with
  `warp: { reviewer, implementer }`. Export `rendersFor(templateKey)` and
  `renderDocument(def, doc, backlinks, {render, budget?, baseUrl?})` (throws 422 with
  available names on unknown render).
- **reviewer**: title → decisions (expanded relation titles, id fallback) → open
  questions → code pointers → compressed state (excerptFrom). **implementer**:
  next_action first → open questions → compressed state → code/setup.
- Budget: `applyBudget(sections[{priority, text}], budgetTokens?)` (exported for tests);
  charBudget = budget × `APPROX_CHARS_PER_TOKEN` (new const in
  `src/config/constants.ts` = 4); priority allocation, word-safe truncation via
  `excerptFrom`, assemble in display order.

### 4. One service function — new `src/services/documents/render.ts` — **DONE**
- `renderDocumentText(db, principal, slug, id, {render, budget?, baseUrl?}, now)`:
  getCollection → validate render name against `rendersFor(def.template)` *before* the
  read → validate budget (positive int) → `getDocument` (authorize + relation/media
  expansion inside) → `getBacklinks` only if `needsBacklinks` → `renderDocument`.
  Re-export from the documents barrel (tools.ts imports `* as docs`).

### 5. MCP wiring — `src/mcp/tools.ts` + `src/mcp/handler.ts` — **DONE**
- tools.ts: export `McpTextResult` sentinel + `isMcpTextResult` + `mcpText()`. In
  `get_<slug>` (lines ~351-356): when `rendersFor(def.template)` non-empty, add
  `render: {type:'string', enum: renders}` + `budget: {type:'integer'}` to inputSchema
  and mention renders in the description; handler branches to
  `mcpText(await docs.renderDocumentText(...))` when `args.render` present.
- handler.ts (~line 86): `isMcpTextResult(value)` → emit `value.text` raw; else existing
  `JSON.stringify`. Errors already flow via the AppError→isError mapping.

### 6. REST wiring — `src/routes/api/c/[collection]/[id]/index.tsx` — **DONE**
- Parse `render`/`budget` query params; when `render` present return
  `c.body(md, 200, {'Content-Type': 'text/markdown; charset=utf-8'})` (rss `c.body`
  precedent in main.tsx); else unchanged. Route stays thin — NaN budget flows to the
  service's 422.
- `src/lib/openapi.ts`: add `render`/`budget` query params to the doc GET path when the
  collection's template declares renders (~10 lines; keeps OpenAPI honest).

### 7. Tests (Vitest, co-located `*.test.ts`) — **DONE**
- New `src/templates/collab-pack.test.ts` (model: `prompt-pack.test.ts`): all three
  scaffolds pass `validateDefinition`; private + lifecycle-none; templates resolve; warp
  template renders title/role/state/decision titles/next-action (escaped); status
  template renders title + stage Stamp label + goal + "Needs a human" panel (and omits
  it when empty) + grouped backlinks; renders bare without error.
- New `src/templates/renders.test.ts`: reviewer/implementer section ordering; budget
  truncation bounds + priority survival; unknown render throws with names in details;
  `rendersFor('article')` = [].
- New `src/services/documents/render.test.ts` (D1 harness): happy path; ForbiddenError
  for denied principal; unknown render 422 *before* doc read; render on template without
  renders → 422.
- Modify `src/mcp/mcp.test.ts`: get_warps advertises render enum, get_articles doesn't;
  render call returns literal markdown (not JSON-quoted); unknown render → isError with
  names. Check `mcp-parity.test.ts` for a generic parity arm.
- Modify `src/routes/api/api.test.ts`: 200 text/markdown; bogus render 422; plain GET
  unchanged. Modify `packs.test.ts` per step 2.

### 8. Docs — **DONE**
- `docs/TECH_DECISIONS.md` — **D47**: collab pack + text renders; all settled decisions
  above incl. deferred items (Backlink excerpt, webhooks) and non-goals.
- `CLAUDE.md` build-status note; `steering/SCHEMA_ENGINE.md` "Text renders (D47)" bullet
  (a seventh derived surface riding `read`); `steering/API_AND_MCP_STANDARDS.md` —
  `?render=&budget=` + get_<slug> args + text passthrough.

## Verification

`bun run type-check && bun run lint && bun run test:run`

Manual end-to-end (`bun run dev`, admin bearer token `$T`):
1. MCP `install_pack {pack:'collab'}` → 3 collections.
2. `create_tasks {title, goal, stage:'building', open_questions:'- locale?'}` →
   `create_decisions {title, task, verdict:'recommended'}` →
   `create_warps {...}`; also verify the 422 beat: `create_warps` **without**
   `open_questions` → VALIDATION with path.
3. `get_warps {id, render:'reviewer', budget:2000}` → literal markdown in
   content[0].text (newlines unescaped). Small budget → priority sections survive.
4. `GET /api/c/warps/:id?render=implementer&budget=1500` → text/markdown, next-action
   first; `?render=bogus` → 422 listing reviewer/implementer.
5. `share_link_tasks {id, expiresAt}` → open `/s/<token>` → status page: title, stage
   stamp, goal, "Needs a human" panel, decisions/warps lists.
6. Confirm private discovery (collab collections absent from anonymous
   `GET /api/collections`) and no `publish_tasks` tool (lifecycle none).

## Key files
- `src/templates/packs.ts`, `keys.ts`, `registry.ts`, **new** `warp.tsx`, **new**
  `status.tsx`, **new** `renders.ts`
- **new** `src/services/documents/render.ts` (+ barrel re-export)
- `src/mcp/tools.ts`, `src/mcp/handler.ts`
- `src/routes/api/c/[collection]/[id]/index.tsx`, `src/lib/openapi.ts`
- `src/config/constants.ts` (APPROX_CHARS_PER_TOKEN)
- tests + docs per steps 7–8

## Revision Log

- 2026-07-21: `renderDocumentText` lives in `src/services/documents/index.ts` (the service is a
  single module — no barrel/submodule split exists to mirror), not a separate `render.ts`.
- 2026-07-21: REST route passes no `baseUrl` (resolveBaseUrl needs env+settings; the warp renders
  emit no links). MCP path threads its already-resolved baseUrl.
- 2026-07-21: "Needs a human" is not hard-coded in the status template — the generic template
  renders trailing markdown fields as labelled callouts, and the PACK sets `label: 'Needs a human'`
  on tasks.open_questions (schema-engine grain: generic code, bespoke data).
- 2026-07-21: verification finding — the anonymous share-link status page shows task content only;
  backlink groups are access-scoped to the link identity and warps/decisions are private
  (never-a-leak, correct). Recorded in D47; a "link includes related collections" option is future.
