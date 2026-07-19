# Private collections — `access.private` (D46)

**Status: COMPLETE — 2026-07-18**

## Context

Anonymous probing of the live `/mcp` endpoint (2026-07-18) showed that while a non-`publicRead` collection's **documents** are fully hidden on every surface, its **existence and field shape** leak to everyone through the discovery surfaces: MCP `list_collections`, REST `GET /api/collections[/:slug]`, pack `installed` state (`list_packs` / `GET /api/packs`), and — found during planning — the ungated `/api/openapi.json`, which emits per-collection paths + full document JSON schemas (`src/main.tsx:98-101` → `generateOpenApi` reading `listCollections` directly). The live `prompts` collection (private-by-default pack, v1.6.0) is visible this way today.

Feature: a collection can be marked **private** — invisible in every discovery surface to any principal lacking access. User decisions (confirmed):
- **Capability-based visibility**: a private collection is discoverable only to principals holding `manage_schema` OR a role/token-scope `read` on that collection. Item-grant-only principals do NOT see it in discovery (consistent with `couldDo` in `src/mcp/tools.ts:65`, which also ignores item grants — they reach their document via `/s/:token` / Shared with me).
- **Builder UI**: one 3-way **Visibility** select (Public / Discoverable / Private) replacing the "Public read access" toggle — invalid combo unrepresentable.
- **Prompts pack ships `access: { private: true }`**; live remill.org `prompts` collection remediated after deploy.

Non-changes (stated so the implementation doesn't drift): share links (`/s/:token`) keep working on private collections (item-grant scoped, the D26 prompts-sharing story); document authorization (`decide`/`compileReadFilter`) is untouched — private collections can never be `publicRead`, so content is already deny-by-default; MCP `resources/list` (filters `publicRead`), `prompts/list` (`couldDo`-gated), events feed (`collectionsWithAction ∪ publicRead`), search, feeds/sitemap/homepage (`publicCollections` filters `publicRead`) all already exclude non-public collections — regression-pin, no code change.

**No DB migration**: `access_json` (`src/db/schema.ts:116`) is a JSON text column; queries round-trip the object verbatim.

## Steps

### 1. Type + validation
- `src/fields/types.ts:60` — `access?: { publicRead?: boolean; private?: boolean }`; update the comment (two knobs, mutually exclusive; private = excluded from discovery for principals without manage_schema or role/scope read).
- `src/services/collections/index.ts:41` — `ACCESS_SCHEMA` gains `private: z.boolean().optional()` (strictObject stays — SEC-6).
- `validateDefinition` access branch (~:160-170): reject `private && publicRead` (path `access`, wording mirroring the lifecycle-contradiction message at :153-157).

### 2. Capability helper (TD-3 resolve-once)
- `src/services/access/index.ts:60` — extract the post-fetch body of `collectionsWithAction` into exported pure `collectionsWithActionFrom(perms, principal, action)`; `collectionsWithAction` = fetch + delegate. Zero behavior change; existing callers untouched.

### 3. Discovery filtering (`src/services/collections/index.ts` ~:395-455)
- Helper `canDiscover(def, readable)` = `!def.access?.private || readable === '*' || readable.includes(def.slug)`.
- `listCollectionsForDiscovery`: resolve `getPrincipalPermissions` ONCE → manage_schema ⇒ full defs (current `canSeeInternals` semantics); else `readable = collectionsWithActionFrom(perms, principal, 'read')`, return `defs.filter(canDiscover).map(toPublicView)`.
- `getCollectionForDiscovery`: same rule; hidden ⇒ `null` (REST route already 404s on null — private is indistinguishable from nonexistent, no enumeration oracle).
- New exported `listDiscoverableCollections(db, principal)` — FULL defs filtered by the same rule; powers OpenAPI (step 4) so the rule lives once. Refactor `canSeeInternals` (:428) to take pre-fetched perms.
- `listPackStatuses` (:274) gains a `principal` param: `installed = every(collection exists AND discoverable)`. Non-capable caller sees `installed: false` (indistinguishable from not-installed; anyone who could probe via `install_pack` holds manage_schema and sees truth). Update the doc comment. Call sites: `src/mcp/tools.ts:153` (principal in closure), `src/routes/api/packs/index.tsx` (resolve principal — currently resolves none), `src/routes/admin/marketplace/index.tsx:37` (`requirePrincipal(c)`).

### 4. OpenAPI leak
- `src/lib/openapi.ts:287` — `generateOpenApi(defs: CollectionDefinition[], baseUrl)`; drop its queries-layer `listCollections` import (lib stays below services; caller supplies defs).
- `src/main.tsx:98-101` — handler resolves the caller via `resolvePrincipal(db, c, 'rest', now)` (`@/lib/api-auth`, the REST pattern) and passes `await listDiscoverableCollections(db, principal)`. Anonymous ⇒ static paths + non-private collections; bearer widens. Update the comment block.

### 5. MCP tool descriptions
- `src/mcp/tools.ts` — `create_collection` (~:158) + `update_collection` descriptions: document `access: { publicRead?, private? }`, semantics, mutual exclusivity. `couldDo`/tool generation unchanged (private ⇒ never publicRead ⇒ tools already role/scope-only).

### 6. Prompts pack
- `src/templates/packs.ts` prompts scaffold (~:183): add `access: { private: true }`; update the comment (explicit private pin replaces the deliberate absence). Extend `src/templates/prompt-pack.test.ts`.

### 7. Builder Visibility select
- `src/components/admin/collection-builder.tsx` — replace the Access cell (the `access_public_read` Toggle, ~:518-527 in the new Behaviour grid) with a `FormField`+`Select` named `access_visibility`, options `public` / `default` / `private`; `visibilityValueOf(def)` helper mirroring `lifecycleValueOf` (:145). Plain native select, no signals.
- `parseCollectionForm` (~:140): `access = visibility === 'public' ? { publicRead: true } : visibility === 'private' ? { private: true } : undefined`. (Known pre-existing bug in this function — it also drops `template`/`bind` on save; do NOT fix here, ticket it in plans/BACKLOG.md.)

### 8. Docs
- `steering/ACCESS_CONTROL.md` (~:84 "publicRead is the only collection-level access field") — name both flags, exclusivity, the discovery rule, item-grant exclusion.
- `steering/SCHEMA_ENGINE.md` (definition example + closed-Zod-shapes bullet), `steering/API_AND_MCP_STANDARDS.md` (discovery + OpenAPI scoping).
- `docs/TECH_DECISIONS.md` — **D46**: the flag, capability-based rule, pack-installed honesty, OpenAPI scoping, alternatives rejected (anonymous-only hiding; per-collection item-grant probing).

### 9. Unit tests
- `src/services/collections/collections.test.ts` (SEC-5 block :409-438, validation :72/:456): contradiction rejected; `private` round-trips; anon list omits private; scoped reader sees only its own; admin sees full def; `getCollectionForDiscovery` null vs full; `listPackStatuses` per-caller installed.
- `collectionsWithActionFrom` parity cases (wildcard / scoped token / scoped assignment).
- `src/mcp/mcp.test.ts` (SEC-5 :244): anon + wrongly-scoped token `list_collections` exclude private; admin includes; `list_packs` per-caller; regression pins for anon `prompts/list` (:389) and `resources/list`.
- `src/routes/api/api.test.ts`: `/api/collections[/:slug]` anon-vs-admin; `/api/packs` (:225); `/api/openapi.json` (:267) — anon omits `/api/c/<private>` paths+schemas, admin bearer includes.

### 10. E2E
- API probes (in `public-discovery.spec.ts` or `prompt-pack.spec.ts`): after prompts install, anonymous `request.get('/api/collections')` excludes `prompts`, `/api/collections/prompts` 404s, `/api/openapi.json` has no prompts paths.
- Toggle→select churn (grep `Public read access` across e2e/ — known sites): `e2e/html-pages.spec.ts:42`, `e2e/platform-graph-publish.spec.ts:99`, `e2e/public-discovery.spec.ts:33` → `selectOption('public')` on the Visibility select.
- Builder round-trip in `admin-schema-access.spec.ts`: set Private, save, reload, select shows Private (guards the wholesale-rebuild parser).
- Share-link pin: minted link on a private-collection doc still renders anonymously (extend prompt-pack spec if not already covered).

### 11. Ordering + verification
Order: 1→2→3→4 land together (flag without filtering is hollow; filtering without validation allows the contradiction) → unit tests → 5→6→7 → e2e → 8.

Gates: `bun run type-check`, `lint`, `test:run`, then clean-D1 full `bun run e2e` (kill :3100, `rm -rf .wrangler/state/v3/d1`, migrate+seed first — only a clean run is signal).

Local probes (mirror the live curls): anonymous `/api/collections`, `/api/collections/prompts` (404), MCP `list_collections` + `list_packs`, `/api/openapi.json` paths — repeat with admin bearer (full) and an articles-scoped token (excluded). Share link still renders.

**Post-deploy remediation (live remill.org)**: a `prompts` collection already exists live (anonymous probe showed it). After release: mark it private (admin builder Visibility → Private, or MCP `update_collection`), then re-run the anonymous probes against remill.org to confirm it vanished from `list_collections`, `/api/collections`, and `/api/openapi.json`.

## Risks
- Additive/backward-compatible: existing `access_json` values behave identically; no collection becomes private implicitly.
- Signature ripples are compile-time-caught: `listPackStatuses` (+principal, 3 sites), `generateOpenApi` (defs param, 1 site).
- E2E churn confined to three label swaps + new probes; grep before done.
- Admin-internal surfaces (session humans seeing count-less cards on /admin/c) unchanged — out of scope, noted in D46.
