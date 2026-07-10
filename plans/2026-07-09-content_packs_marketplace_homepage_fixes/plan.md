# Content packs, marketplace, homepage rework & review fixes

## Context

A multi-agent review of the two recent shipments (704afb4 public reading templates / D41, 4db40d0 homepage redesign) found: (1) three shipped bugs — an invisible hero-CTA focus ring, dead active-tab indicators on the EverySurface segmented control (both Tailwind cascade-order traps, verified against compiled CSS), and the raw slug prepended to every article's `og:description` live on remill.org; (2) the "content pack" concept exists only as an unwired constant — `blog-pack.ts` is imported by nothing but its own test, invisible to agents and humans alike, contradicting the agent-first thesis; (3) the homepage never names the customer and its primary CTA ("Connect an agent") is un-actionable for a cold visitor on a single-tenant instance.

User decisions: build **three new packs (docs, changelog, portfolio)**, expose packs through an **internal marketplace** (new admin menu item + MCP tools), do the **full homepage rework** as its own phase, and add a **public collection index page**.

Six phases, each ≈ one independently shippable PR. No DB migrations, no new field types, no new access actions anywhere in this plan.

---

## Phase 1 — Bug fixes (M)

**Files:** `src/components/marketing.tsx`, `src/services/documents/index.ts`, `src/routes/[collection]/[slug]/index.tsx` (prettier only), `steering/API_AND_MCP_STANDARDS.md`, tests.

1. **Focus ring (marketing.tsx:40):** drop `focus-visible:outline-ring` from `HERO_CTA_BASE`, keep `outline-accent-fg`. (Compiled CSS declares `.outline-ring` after `.outline-accent-fg`, so ring wins today; light-mode ring color === accent bg → 1:1 contrast.)
2. **Dead tab indicators (marketing.tsx:160-176):** delete the three broken `data-class:*` toggles; style off `aria-selected` (already reactively toggled via `data-attr`) with a scoped `<style>` in EverySurface: `[data-rm-tab][aria-selected="true"]{border-color:var(--color-accent);color:var(--color-ink);font-weight:600;}`. Mirrors the existing `#rm-sidebar.rm-nav-open` scoped-style idiom (admin-shell.tsx:119). Sidesteps both the never-generated `.border-accent` utility and the `text-ink`/`text-ink-muted` cascade race.
3. **og:description slug leak:** root-cause fix in `buildSearchText` (src/services/documents/index.ts:170-199) — skip `field.type === 'slug'` in the body loop. Fixes og/meta description, discovery excerpts, and FTS body pollution in one place. **Operational step after deploy: run the admin Settings → rebuild search index** (`rebuildSearchIndex`, src/services/search/index.ts:108) so stored FTS rows pick up the change.
4. **Snippet drift (marketing.tsx:102-118):** correct fake REST response to the real flat shape `{data, page, pageSize, total}`; prefix fake ids with `doc_`.
5. **Arrow-key nav on the tablist:** roving tabindex via Datastar — `data-attr:tabindex` (`$tab===key ? '0' : '-1'`), `data-on:keydown` mapping ArrowLeft/Right/Home/End to set `$tab` + focus (selection-follows-focus, APG automatic activation). Required by steering/A11Y_STANDARDS.md:32-33.
6. **Minors:** add the `media` read-expansion sibling bullet beside `relations` in API_AND_MCP_STANDARDS.md:71-77; fix prettier drift at the article route head-options literal.

**Tests:** marketing.test.tsx asserts corrected snippet (`"pageSize"`, `doc_`); new EverySurface render test (tabindex/aria-selected initial state + scoped style rule); buildSearchText unit test (slug value absent from body); e2e og:description assertion in public-reading.spec.ts; new e2e marketing tablist spec (own `CF-Connecting-IP`) with arrow-key drive + axe both themes.

**Verify:** `bun run type-check && bun run lint && bun run format:check && bun run test:run && bun run e2e`. Manual: keyboard-drive `/` — visible focus ring on hero CTAs, visible selected-tab underline/color; view-source a live article — og:description no longer starts with the slug.

---

## Phase 2 — Convention & template-contract hardening (M)

Behavior-preserving for article; makes Phase 4 purely additive (Phase 2 is the single owner of edits to `templates/types.ts`, `conventions.ts`, and the render route).

**Files:** `src/templates/lib/conventions.ts`, `src/templates/types.ts`, `src/templates/article.tsx`, `src/lib/def-helpers.ts`, `src/fields/types.ts`, `src/services/collections/index.ts`, `src/routes/[collection]/[slug]/index.tsx`, tests.

1. **Parameterized resolver (not copy-per-template):** `resolveConventionLayout(def, opts?: {wantHero?: boolean; wantLead?: boolean})` defaulting to today's behavior. Changelog will pass `{wantHero:false,wantLead:false}`, docs `{wantHero:false}`, portfolio defaults.
2. **`bind` escape hatch ships now** for scalar slots: `bind?: Partial<Record<'title'|'hero'|'lead', string>>` on `CollectionDefinition` (lives in the definition JSON — no migration; agents can set it via create_collection). Resolver consults `def.bind` first, falls back to convention. `validateDefinition` rejects unknown slots / non-existent field keys. Body/meta binding stays reserved.
3. **Title/slug fix:** `titleFieldOf` (src/lib/def-helpers.ts) prefers `text` over `slug` (`find(text) ?? find(slug)`), so a slug-first collection never renders its slug as the H1. Blast radius: shared by FTS title, relation-expansion titles, OG/feeds — unchanged for all title-before-slug collections (every pack scaffold); slug-first collections change intentionally. FTS titles for such collections update on reindex/resave.
4. **Capability flags:** `wants?: {readingTime?: boolean; shareBar?: boolean}` on `RenderTemplate`; article sets both true (byte-identical output). Route gates the share `<Script>` load, `shareUrl`, and the `readingTimeMinutes` call off `tpl.wants` instead of tpl-truthiness.
5. **Drift test tightening:** blog-pack.test.ts gains a render-level assertion — render article over a scaffold-shaped doc, assert non-empty hero (`src="/media/`), dek (`rm-standfirst`), body.

**Verify:** full unit suite + `bun run e2e` public-reading.spec.ts — a live article renders identically.

---

## Phase 3 — Pack + marketplace infrastructure, blog pack only (L)

**New files:** `src/templates/packs.ts`; REST routes `src/routes/api/templates/index.tsx`, `src/routes/api/packs/index.tsx`, `src/routes/api/packs/[key]/install.tsx`; admin page `src/routes/admin/marketplace/index.tsx`; tests (`packs.test.ts`, `install-pack.test.ts`, MCP/REST additions, `e2e/marketplace.spec.ts`).
**Modified:** `src/services/collections/index.ts` (installPack), `src/mcp/tools.ts`, `src/lib/openapi.ts` (staticPaths), `src/components/layouts/admin-shell.tsx` (nav), `src/components/ui/icon.tsx` (new `Store` glyph — none exists in the barrel), `src/templates/blog-pack.ts` (scaffold moves into packs.ts; keep a re-export), `docs/TECH_DECISIONS.md` (D42), `CLAUDE.md`, `steering/API_AND_MCP_STANDARDS.md`, `steering/SCHEMA_ENGINE.md`.

1. **Pack type** (closed registry mirroring templates): `{key, name, description, template: TemplateKey, collections: readonly CollectionDefinition[]}` — array from day one (docs pack may grow multi-collection); blog moves in as the first pack.
2. **`installPack(db, principal, key, now, opts?: {slug?})`** in the collections service: unknown key → NotFoundError; slug override valid only for single-collection packs; **pre-flight conflict check across all target slugs** (all-or-nothing — D1 writes aren't transactional across collections); then loops the existing `createCollection` — inheriting `authorize('manage_schema')`, `validateDefinition`, ConflictError, and the D33 `collection.created` outbox event for free. All surfaces call this one service (shared-foundation rule).
3. **MCP tools** (purely additive in `buildToolsForPrincipal`; handler.ts untouched): `list_templates` + `list_packs` ungated (like `list_collections`; list_packs includes target slugs + `installed` status), `install_pack` gated `couldDo(perms, principal, 'manage_schema', '*', false)` with args `{pack, slug?}`. Amend `create_collection`'s description to mention `template` and point at `list_templates`. Agent flow becomes: `list_packs` → `install_pack('blog')` → `create_articles` → `publish_articles`.
4. **REST parity:** `GET /api/templates`, `GET /api/packs`, `POST /api/packs/:key/install` — thin `factory.createHandlers(requireAuth(), …)` routes calling the same service; hand-add all three to `staticPaths()` (trash precedent, src/lib/openapi.ts:127-142).
5. **Admin Marketplace page:** NAV_ITEMS entry after `collections` (admin-shell.tsx:57-67), key added to `NAV_BY_ROLE.admin` only (install gates on manage_schema — showing it to others would 403). Page = pack cards (name, description, template, field summary, installed state → disabled button). Install button posts to the marketplace route (Datastar `@post`, busy signal, per the token-issue exemplar access/index.tsx:139-152); success → `dsRedirect` to the new collection (collections/new.tsx pattern); error → `renderSaveError` morph fragment.

**Tests:** every pack key resolves a registered template + all scaffolds pass validateDefinition; installPack success/conflict/slug-override/multi-collection-override-rejection + event emission; MCP visibility matrix (anonymous sees list_* only; manage_schema sees install_pack); REST 201/409/403; e2e marketplace install flow (own IP; per-run-unique slug override so reruns don't ConflictError).

**Verify:** `bun run routes && bun run type-check && bun run lint && bun run test:run && bun run e2e`; `curl /api/openapi.json | jq` shows the three static paths; MCP `tools/list` shows install_pack for admin token only.

---

## Phase 4 — Three packs + templates (L; three sub-PRs)

Each sub-PR: new `src/templates/<name>.tsx` + key in `keys.ts` + entry in `registry.ts` (compiler-enforced exhaustive) + pack entry in `packs.ts` + tests mirroring article.test.tsx and blog-pack.test.ts incl. the render-level drift assertion. All use the 12 existing field types (`url`→text, date→datetime, semver→text). No route/contract edits — Phase 2 froze those.

- **4a Changelog (first — proves opt-out, S/M):** fields version (text, title) · date (datetime) · type (select: added/changed/fixed/security/deprecated/removed) · body (markdown); `template:'changelog'`. Template `wants:{}` — no hero, no lead, no share bar, no reading time; reads date/type explicitly (bespoke header line: version + formatDate + Badge), body below. Proves a template loads no share island.
- **4b Portfolio (media-first, M):** fields title · slug · cover (media) · summary (text) · link (text-as-URL) · body (markdown) · tags. Template `wants:{shareBar:true}`; convention binds cover→hero, summary→lead; `link` rendered as a prominent link-out (`rel="noopener"`), tags in meta.
- **4c Docs (M):** fields title · slug · section (select — self-ref parent relation deferred) · order (number) · body (markdown) · related (relation, multiple, self-ref). Template `wants:{}`, `{wantHero:false}` layout, backlinks surfaced high; prev/next deferred.

**Verify per sub-PR:** type-check (registry exhaustiveness fails loudly), unit suite; manual — install the pack via `/admin/marketplace`, create+publish via MCP `create_<slug>`, view the public page. New e2e spec files get their own IPs + per-run-unique fixture titles.

---

## Phase 5 — Public reading polish (M)

**Files:** new `src/routes/[collection]/index.tsx`; `src/components/layouts/public-shell.tsx`; `src/layouts.tsx`; new `src/templates/lib/dedupe-backlinks.ts`; the four templates; tests.

1. **Public collection index (`GET /:collection`):** reuse the discovery service (`publicCollections` gate publicRead+lifecycle, `publishedDocs`, `toDiscoveryDoc` — title/path/excerpt/publishedAt); one clean shared list in PublicShell; non-public collection → indistinguishable `PublicNotFound` 404 (same posture as `[slug]`); first-page cap for v1. `RESERVED_COLLECTION_SLUGS` (src/config/constants.ts:25) prevents shadowing at create time — during implementation confirm router precedence for the static `/media/:id` route vs `[collection]` (note: `media` is not in the reserved list).
2. **Backlink dedupe in the template layer:** `dedupeBacklinks(backlinks, def, doc)` filters backlinks whose id appears in any forward relation field value; applied before `<Backlinks>` in all templates. REST/MCP `backlinks_<slug>` keeps returning the whole reverse graph — this is presentation-only.
3. **PublicShell footer:** add RSS + sitemap links (currently bare siteName).
4. **`twitter:card` meta** (`summary_large_image` + title/description/image mirroring og), emitted only when og props are set, in the root layout head.
5. **Wayfinding:** article masthead/footer links to `/{collection}` ("More from <name>"). Long-form public dates (July 9, 2026) via a formatDate option; admin stays compact.

**Verify:** `bun run routes` + suites + e2e public-discovery/public-reading; manual — `/articles` lists posts, private collection 404s, backlinks no longer duplicate the forward "Related" field, view-source shows twitter:card.

---

## Phase 6 — Homepage rework P1–P7 (L) — must land after Phase 1

**Files:** `src/components/marketing.tsx`, `src/components/layouts/marketing-shell.tsx`, `src/components/marketing.test.tsx`. Copy raw material: `docs/PROJECT_BRIEF.md` success criteria (lines 146–165).

- **P1** audience/problem strip between hero and EverySurface ("A backend where the AI is a citizen, not a shared key" / "For builders who let agents write").
- **P2** "Run your own mill" first-class section — repo link, deploy story, the ten-minute claim; primary CTA becomes "Run your own mill", "Connect an agent" demotes to second.
- **P3** trust section headline becomes the falsifiable claim: "Your agent can draft all night. It still can't publish." + audit-trail subline; replace "Built for trust".
- **P4** use-case section, 3–4 customer-voice stories (agent-drafts-human-publishes; scoped-token agent backend; own-your-publishing; portable knowledge).
- **P5** reframe "Latest writing" as dogfood proof ("This site is a remill"); hide empty collections by filtering `sections` to `docs.length>0` in PublishedIndex (kills "Media — Nothing published yet"; the whole-page EmptyState for a fresh install stays).
- **P6** footer credibility layer: repo, `/api/openapi.json`, `/mcp` docs pointer, license, built-by, live-since.
- **P7** H2 becomes a value claim ("Define it once. It ships six ways — no deploy.") — kills the H1/H2 echo.

**Contract strings (marketing.test.tsx:23-26, verified):** keep `id="connect"`, `https://example.org/mcp`, and the fresh-install "Nothing published yet" EmptyState assertion; update the H1 assertion only if P1/P2 rewrite the hero; add assertions for the P2 section, P7 H2, and the P5 heading — all updated deliberately in the same PR. Head-props test unchanged. All new interactive elements follow Phase 1's attribute-driven state + visible focus rules.

**Verify:** unit suite + e2e axe sweep on `/` both themes; manual keyboard-only pass over every new control.

---

## Risks & notes

- **`titleFieldOf` change** touches FTS titles, relation expansion, OG, feeds — no-op for all title-first collections (every scaffold in this plan); slug-first collections change intentionally; reindex updates stored titles.
- **`buildSearchText` slug exclusion**: render surfaces fix on deploy; stored FTS rows need the admin rebuild (exists: Settings → rebuild, `rebuildSearchIndex` src/services/search/index.ts:108). Run it post-deploy of Phase 1.
- **Partial installs** prevented by installPack's pre-flight all-slugs check.
- **`bun run routes`** required after adding any route file (Phases 3 & 5) — type-check runs it, but don't skip locally.
- **No migrations, no new actions, no new field types** anywhere. `bind` and `template` live inside the definition JSON.
- Marketplace icon: add a small `Store` function to `src/components/ui/icon.tsx` (verified: no suitable glyph exists).

## Verification (end-to-end, after all phases)

1. `bun run type-check && bun run lint && bun run format:check && bun run test:run && bun run e2e`
2. Agent flow over MCP against a preview deploy: `list_packs` → `install_pack('changelog')` → `create_changelog` → `publish_changelog` → fetch the public page + `/changelog` index.
3. Admin flow: Marketplace → install portfolio → land on collection → create/publish → public page renders portfolio template.
4. Live checks post-deploy: og:description clean, focus ring visible, tab indicators visible, homepage sections per P1–P7, rebuild search index once.
