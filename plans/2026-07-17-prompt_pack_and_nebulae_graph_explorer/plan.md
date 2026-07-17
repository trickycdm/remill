# Prompt library pack + MCP prompts primitive + Nebulae graph explorer

## Context

Brainstorm (2026-07-17) committed two features from `plans/BACKLOG.md`:

1. **Prompt library** — a D42 content pack (new `prompt` template + co-designed
   `prompts` collection), plus the novel piece: items in prompt-shaped collections
   served as **native MCP prompts** (`prompts/list` / `prompts/get`), so any MCP
   client shows the library in its prompt picker with typed arguments derived from
   the item's `variables` field. Revisions (D39) give versioning free. Evals
   deliberately excluded (backlog).
2. **Graph explorer** at `/admin/graph` over Track B relations. Look chosen via a
   two-round artifact: **"Nebulae"** — 3D canvas universe in the gig-poster dark
   register; collection clusters as tilted galactic disks with haze, cross-cluster
   relations as lifted arc flight paths, pop pink reserved for hover/selection,
   drag-to-orbit, starfield, depth fog. A working ~350-line reference engine
   (plain canvas, zero deps) was built in the artifact and gets ported.

**User decisions (settled):** prompts are **private by default** (no `publicRead`;
admin/tokens/share-links only; owner can flip later) · graph **click navigates**
to the item editor · Nebulae direction · no eval pack now.

**Conventions taken:** MCP prompt marker = `def.template === 'prompt'` (not slug —
renamed/hand-built collections participate) · body = `markdown` field (CodeMirror
free) · graph payload embedded via `jsonForScript`, compact edge encoding
(`[srcIdx, tgtIdx]` pairs ⇒ ~200KB raw / ~40–60KB gzipped at full cap), caps
1,500 nodes / 4,000 edges with honest `truncated` flag; fetch endpoint is the
recorded escape hatch · pack key `prompt-library`, collection slug `prompts`.

**Three PRs:** A (pack) → B (MCP primitive, needs A's template key) → C (graph,
independent). On approval: sync `plans/2026-07-17-prompt_pack_nebulae_graph/plan.md`
to this final version + append worklog rows as work proceeds.

---

## PR 1 — `prompt` template + `prompt-library` pack

1. `src/templates/keys.ts` — add `'prompt'` to `TEMPLATE_KEYS` (exhaustive
   records force registry + packs updates; build enforces).
2. **`src/templates/lib/prompt-shape.ts` (new)** — pure shared helpers (the
   `conventions.ts` grain); template, MCP builder, and tests all consume these:
   - `PROMPT_VAR_RE = /\{\{\s*([A-Za-z0-9_][\w.-]*)\s*\}\}/g`
   - `promptBodyFieldOf(def)` — first markdown field (changelog's by-type grain)
   - `promptVariablesFieldOf(def)` — tags field keyed `variables`
   - `promptVariables(def, data)` — declared ∪ scanned-from-body, deduped, ordered
   - `splitPromptTokens(text)` → `{kind:'text'|'var', value}[]` for safe JSX
   - `interpolatePrompt(text, args)` — **split/join, not String.replace** (immune
     to `$&`-style patterns in user argument values); missing args stay verbatim
3. `src/templates/prompt.tsx` (new) — copy `changelog.tsx` structure.
   `wants: { shareBar: true }`, no reading time.
   `resolveConventionLayout(def, { wantHero: false, wantLead: false })`.
   Bespoke claims (the `claimed` Set pattern): body → mono prompt panel
   (`<pre><code>` with `splitPromptTokens` mapped to **alternating JSX text nodes
   and `<mark>` elements** — JSX auto-escapes; no dangerouslySetInnerHTML, no
   manual escaping); `variables` → chips; first select (`model`) → meta badge.
   Remaining markdown fields (`notes`, `example_output`) as labelled `FieldView`
   prose; `Backlinks` closes.
4. `src/templates/registry.ts` — register `prompt: promptTemplate`.
5. `src/templates/packs.ts` — add `'prompt-library'` to `PACK_KEYS` +
   `promptsCollectionScaffold` + `PACKS` entry (`template: 'prompt'`; pack
   description states prompts are private by default):

   | key | type | notes |
   |---|---|---|
   | `title` | text | required, index, showInList |
   | `slug` | slug | `config.from: 'title'`, unique, index |
   | `body` | markdown | required; `{{variable}}` placeholders |
   | `variables` | tags | help: "become MCP prompt arguments" |
   | `model` | select | options any/claude/gpt/gemini/other, **optional — select has no default mechanism** |
   | `tags` | tags | index |
   | `notes` | markdown | usage guidance |
   | `example_output` | markdown | optional |

   `workflow: { draftPublish: true }`, **no `access` block**, no `bind`.

**Not touched:** Marketplace/MCP/REST surfaces (iterate the registry);
`packs.test.ts` (loops `PACK_KEYS` automatically).

**Tests:** `src/templates/prompt-pack.test.ts` (copy blog-pack.test.ts): scaffold
validates + selects `prompt`; **privacy pin** (`access?.publicRead` falsy); render
synthetic doc — `{{topic}}` in `<mark>`, `<script>` in body appears escaped,
chips render, `wants` exact. `src/templates/lib/prompt-shape.test.ts`: tokenizer
edges (`{{a}}{{b}}`, whitespace, unclosed, empty), `$&`/`$'` in values, dedupe.
`e2e/prompt-pack.spec.ts` (marketplace.spec.ts pattern, distinct
`CF-Connecting-IP` 203.0.113.70, conditional install guard for persisted D1):
install → `dsRedirect` to `/admin/collections/prompts` → author (**`fillMarkdown`
only** for body; variables via plain tags input) → publish → **anon context gets
404 on `/prompts/<slug>`** (privacy assertion) → axe sweep.

---

## PR 2 — MCP `prompts` primitive

1. **`src/mcp/prompts.ts` (new)** — two functions:
   - `listPromptsForPrincipal(db, principal, now)` → `McpPromptDescriptor[]`
     (`name`, `description?`, `arguments: {name, required: false}[]`).
     `getPrincipalPermissions` + `listCollections`, filter
     `def.template === 'prompt'`, gate via **`couldDo` exported from tools.ts**
     (honors token scope mask — do not duplicate). Per visible collection:
     `listDocuments(db, principal, slug, { status: 'published', pageSize: 100 },
     now())` — service path enforces `authorize()` + compiled read filter.
     Name `${collectionSlug}/${itemSlug || docId}` (slug-field value, `doc.id`
     fallback — the `publicUrlOf` precedent). Description `titleOf` + ` — ` +
     `excerptFrom(notes || body)`. Arguments from `promptVariables`.
   - `getPromptForPrincipal(db, principal, name, args, now)` → `{ description?,
     messages: [{ role: 'user', content: { type: 'text', text } }] }`.
     Split name at **first** `/` (slugs can't contain `/`); **require
     `def.template === 'prompt'`**; resolve ref: `doc_…` → `getDocument` +
     explicit `status === 'published'` check, else `listDocuments` filtered on
     the slug field, pageSize 1; body via `promptBodyFieldOf`;
     `interpolatePrompt(body, args)`.
2. `src/mcp/handler.ts` — capabilities → `{ tools: {}, resources: {}, prompts: {} }`
   (line ~55); two `case`s beside `resources/*`:
   - `prompts/list` → `result(id, { prompts })`. Ignore `params.cursor`, omit
     `nextCursor` — single-page is spec-compliant (2024-11-05, verified).
   - `prompts/get` → coerce `params.arguments` values to strings; try/catch
     mapping `NotFoundError`/`ForbiddenError` → `error(id, -32602,
     'Unknown prompt: <name>')` — one indistinguishable shape, no existence
     oracle (the invalid-uri pattern).

**Edge cases:** anonymous/unscoped → `[]` (private scaffold + couldDo =
permission-filtered discovery); cross-collection name collisions impossible
(slug prefix); duplicate item slugs only in hand-built non-unique defs —
first-match-wins, documented in module header; renamed installs participate
(template marker). Deferred: `listChanged`, revision pinning.

**Tests** (`src/mcp/mcp.test.ts`, existing `mcp()` harness): initialize
advertises `prompts`; install pack → list shows published item + arguments, NOT
drafts; `*`-read token sees it, scope-masked-elsewhere token sees `[]`, anonymous
`[]`; get interpolates, missing arg verbatim, `$&` survives; unknown name and
non-prompt collection → `-32602`; `doc_id` form resolves.

**Docs:** `steering/API_AND_MCP_STANDARDS.md` "Prompts" bullet beside Resources
(~166); `docs/TECH_DECISIONS.md` **D44** (log ends at D43 — verified free).

---

## PR 3 — `/admin/graph` Nebulae explorer

1. **`src/db/queries/documents.ts`** — two additions (service-only):
   - `listGraphNodes(db, scope: { collection, titleFieldKey?, accessFilter?,
     limit }, _grant: Grant)` → `{ id, status, publishAt, title | null }[]` —
     projects title via `json_extract(data_json, '$.' || key)` **in D1; full
     `data_json` never transfers** (service `listDocuments` is wrong here: 100-row
     clamp + expandRelations + full rows).
   - `listAllEdges(db, pairs: {collection, fieldKey}[], limit, _grants)` →
     `{ sourceId, sourceCollection, fieldKey, targetId }[]` — one scan of
     `document_index` (covered by `document_index_text_idx`). **Access-blind by
     design** — the service intersects endpoints.
2. **`graphData(db, principal, now)` in `src/services/documents/index.ts`** —
   `contentOverview` scaffolding verbatim: `collectionsWithAction(…, 'read')` →
   permissions resolved once → per collection `authorize` + `compileReadFilter`
   → `listGraphNodes` with `titleFieldOf(def)` and remaining budget
   (`GRAPH_MAX_NODES = 1500`, fetch +1 to set `truncated`). Relation pairs:
   `f.index && referencesOf(f)` (non-indexed relations have no edges —
   documented). `listAllEdges` (`GRAPH_MAX_EDGES = 4000` + 1), then **drop edges
   with endpoints outside the visible node set** (backlinks' invisible-never-a-leak
   posture; also covers cap-lost targets). Returns `{ nodes: { id, collection,
   title, status: 'draft'|'published'|'scheduled' /* derived: draft+publishAt */ },
   edges, collections /* legend, def order */, truncated }`.
3. **`src/routes/admin/graph/index.tsx` (new)** — `requireAuth()` handlers
   (activity/index.tsx shape), `AdminShell current="graph"`, calls `graphData`
   only (routes never touch D1). Route compacts payload: `{ nodes,
   links: [srcIdx, tgtIdx][], collections, truncated }` (fieldKey/collection of
   edges stay server-side in v1). Embed: `<script type="application/json"
   id="rm-graph-data">` via `jsonForScript` + `<Script src="/src/client/graph.ts" />`
   **in the route file** (Vite discovery). Plate wrapped in `rm-dark-act`;
   `<canvas role="img" aria-label="N items across M collections, E relations">`.
   **Visually-hidden summary region, NOT per-node links** (1,500 links = keyboard
   trap): per-collection name + visible count linking `/admin/c/:slug`, edge
   total, truncated notice; visible banner when `truncated`.
4. `src/components/layouts/admin-shell.tsx` — `NAV_ITEMS` entry (`graph`,
   `/admin/graph`, new icon glyph beside existing set) + `'graph'` in the
   `NAV_BY_ROLE` lists (UI-hiding only; service gates).
5. **`src/client/graph.ts` (new)** — port the reference engine: mount off
   `#rm-graph-data` with dataset double-mount guard, tolerate absent target.
   Resolve concrete colors **once** via `getComputedStyle` inside the dark
   subtree (tokens are constant there regardless of `data-theme` — **no theme
   observer**). Engine: deterministic PRNG, cluster centroids per collection,
   disk-gaussian placement, haze sprites, starfield, depth fog, intra-cluster
   lines, precomputed lifted-arc samples cross-cluster, sprite cache, pointer-
   capture drag-orbit, idle auto-drift, hover → pop neighborhood + labels,
   click → `location.assign('/admin/c/'+collection+'/'+id)`, legend chips as
   real `<button>`s toggling collections. **Reduced-motion self-gate**
   (`matchMedia` + `change` listener): no auto-drift/twinkle, no free-running
   rAF — static frame + interaction-driven renders (load-bearing: `loginAsAdmin`
   forces `reducedMotion: 'reduce'`, so axe sweeps the static state).
6. Docs: `docs/TECH_DECISIONS.md` **D45**; CLAUDE.md/steering via `/wrap-up`.

**No Datastar coupling:** the page uses no signals/SSE patches; nothing may morph
the canvas subtree.

**Tests:** Vitest service — `own`-filtered author sees only their nodes, edges to
invisible nodes dropped, scheduled derivation, caps set `truncated`, non-indexed
relation → no edges. Query — title projection (indexed/missing → null), pair
matching + limit. e2e `e2e/admin-graph.spec.ts` (**not** graph.spec.ts —
collides with platform-graph-publish.spec.ts; distinct IP 203.0.113.77): login →
nav → canvas with accessible name, hidden summary, legend chips focusable, no
truncated banner at seed scale, axe sweep (AxeBuilder + WCAG tags).

---

## Risk register

- **Live `prompts` collection conflict on remill.org**: `installPack` pre-flights
  → hard 409 (no idempotency). MCP/REST accept `{slug}` override; Marketplace UI
  has no slug input — acceptable v1, recorded. Check the live site before install.
- **Interpolation `$`-patterns**: split/join mandated.
- **e2e flake traps** (from memory + E2E_TESTING.md): `fillMarkdown` only for
  CodeMirror; Playwright 1.61.1 drops `use.reducedMotion` — manual contexts must
  pass `reducedMotion: 'reduce'`; distinct `CF-Connecting-IP` per spec file;
  persisted local e2e D1 → conditional install guard.
- **Payload growth**: `truncated` flag now; `/admin/graph/data` fetch endpoint +
  columnar encoding recorded as escape hatch (deferred).

## Verification (every PR)

`bun run type-check` · `bun run lint` · `bun run test:run` · `bun run e2e`.
Manual — PR 1: Marketplace install, author with CodeMirror island, anon 404.
PR 2: curl `prompts/list`/`prompts/get` against `bun run dev` with a scoped
token; optionally point Claude Code's MCP client at dev and check the picker.
PR 3: drag/hover/click on seed data, both admin themes (plate stays dark), OS
reduced-motion → static plate, lower cap in dev to see `truncated`. `/verify`
before each commit.
