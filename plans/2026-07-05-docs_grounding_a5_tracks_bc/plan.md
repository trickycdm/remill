# Plan — Docs grounding, A5 close-out, and corrected Tracks B & C

**Status: COMPLETE — 2026-07-05** (every phase executed; per this plan's master-plan discipline the
per-phase record lives in `plans/2026-07-05-platform_knowledge_publishing_roadmap/worklog.md`. B5
stays deferred by design. One execution deviation: Phase 0b (commit A5) ran BEFORE Phase 0 — A5's
working-tree diff touched `steering/ACCESS_CONTROL.md`, which Phase 0 also edited, so committing A5
first kept both commits clean.)

## Context

The approved 3-track roadmap (`plans/2026-07-05-platform_knowledge_publishing_roadmap/plan.md`)
is turning remill from "v1 CMS" into a **general, secure, agent-native headless data platform
that publishes & connects knowledge**. Track A (access legibility, A1–A4) is committed; A5 is
code-complete and uncommitted. This session validated the remaining Tracks B & C against the
real code (three deep read-only sweeps) and audited the documentation.

**Findings driving this plan:**

1. **The approach holds.** All three architectural bets are confirmed: relations via
   `document_index` (index sync already handles N rows/field), read-expansion in the service
   layer (`beforeRender` is unwired and `RenderCtx` has no DB), share links via `item_grants`
   (`subjectKind` has **no CHECK constraint** — `'link'` needs no migration, contrary to the
   plan's cross-cutting note). Anonymous public reads already work end-to-end over REST, so
   Track C reuses existing plumbing.
2. **But the roadmap needs 8 concrete corrections** (below) before execution — sort ambiguity
   on multi-valued fields, a missing batch loader, backlinks needing a new access-gated query
   (not `isIndexValueTaken` reuse), a builder-UI gap for relation config, a B4 reframe, a B5
   descope, public error-handling/CSP/reserved-slug gaps, and link-grant matching.
3. **There is no whole-system source of truth.** The platform vision lives only in the roadmap
   plan file. `docs/PROJECT_BRIEF.md` still lists public rendering as a non-goal; CLAUDE.md
   absorbed none of Track A; TECH_DECISIONS has a duplicate D18 and no roadmap decisions;
   7 steering docs wear "TARGET — no code yet" headers over implemented bodies.
4. **User decisions:** defer e2e (unit tests travel per phase; one consolidated e2e pass at the
   end); write the end-to-end main flows first; ground the docs before building.

**Master-plan discipline:** the roadmap plan.md remains the single execution artifact. This plan
(a) grounds the docs, (b) commits A5, (c) folds the corrections into the roadmap **in place**
(never a new plan file), then (d) executes the amended roadmap phase-by-phase. Every phase:
`bun run type-check` (0), `bun run lint` (0), `bun run test:run` (green), own commit, worklog row.
`bun run e2e` is **deferred** to the final phase by user decision.

---

## Phase 0 — Documentation grounding (one commit) — DONE (2dd5c54)

Consolidation, not a new doc (a separate ARCHITECTURE.md would fragment identity further).

1. **Rewrite `docs/PROJECT_BRIEF.md`** as the durable whole-system overview:
   - Reframe: "single-tenant, lightweight, **agent-native headless data platform** that manages,
     publishes & connects any structured knowledge" (keep the Blogmill lineage + six-surfaces
     story — still true and load-bearing).
   - Add: personas (Person/Service/Agent via `subtype`), invite flow (stubbed email), custom
     roles + per-collection token scoping, item-grant sharing + access matrix (all shipped);
     the knowledge-graph direction (relation field, backlinks, expansion); the publish direction
     (render engine, public pages, share links) — marked *in progress*, pointer to the roadmap.
   - Move "public site rendering/themes" out of Non-goals (lines 18–19, 78–79); refresh the
     access-model paragraph (lines 68–74) for personas + product-managed humans.
2. **Refresh `CLAUDE.md`** (stays the thin map, keep ~current length):
   - Build-status paragraph: note Track A shipped on top of the foundation + roadmap pointer.
   - `src/` map: add `src/lib/persona.ts`, `src/lib/email/`, `src/routes/admin/access/**`
     (users/roles/matrix), `src/routes/auth/set-password/[token].tsx`,
     `src/routes/api/c/[collection]/[id]/grants.tsx`, `src/components/admin/share-panel.tsx`.
   - Fix "D1–D17" → "D1–D19+" (line ~127).
3. **Fix `docs/TECH_DECISIONS.md`:**
   - Resolve the duplicate D18 rows (merge if same decision; renumber the second if distinct).
   - Append decisions already taken/shipped: **D19** personas-via-`subtype` (not a new kind),
     **D20** stubbed `EmailTransport` (console now, provider later), **D21** relations reuse
     `document_index` multi-row (no edges table), **D22** share links reuse `item_grants` with
     `subjectKind='link'` (code-only, no migration), **D23** `ViewComponent` render seam on
     `FieldType`. (D21–D23 marked "accepted, landing in Tracks B/C".)
4. **Steering STATUS sweep** — flip stale "TARGET — no code yet" headers to IMPLEMENTED-style
   headers with a one-line current-state note: `SECURITY_STANDARDS.md:3` (worst offender — body
   already documents shipped invite/email code), `CODING_CONVENTIONS.md:3`,
   `TESTING_AND_VERIFICATION.md:3`, `DATABASE_STANDARDS.md:3`, `ERROR_HANDLING.md:3`,
   `DATASTAR_PATTERNS.md:3`, `E2E_TESTING.md:3` (+ `A11Y_STANDARDS.md:3` if trivially fixable).
   Fix `API_AND_MCP_STANDARDS.md:68` — still describes the abandoned McpAgent-on-a-DO (violates
   its own D18 header). Add the access matrix to `ACCESS_CONTROL.md` (its one Track-A gap).
5. **`docs/DEPLOY_CHECKLIST.md`:** migration list 0003 → 0005 (subtype backfill, invite_tokens);
   re-seed note mentions `invite_tokens`.
6. **`README.md`:** drop "Phase 0 lands first / wired in Phase 1" staleness; describe the
   working system in ~3 sentences + pointer to CLAUDE.md/PROJECT_BRIEF.
7. **Housekeeping:** `git mv` the garbled plan folder
   `plans/2026-07-05-snake_case_plan_summary_description…review_remediation_29_findings` →
   `plans/2026-07-05-review-remediation`; delete stray `plans/.tmp/ok-lets-create-a-indexed-bunny.md`.

## Phase 0b — Commit A5, close Track A — DONE (4f7c115, ran before Phase 0)

- Working tree already contains the full A5 diff (verified clean this session): `ACCESS_SCHEMA` →
  `z.strictObject({publicRead})`, `CollectionDefinition.access` tightened, reject-role-map test,
  ACCESS_CONTROL.md note, hardened axe sweep. Re-run type-check/lint/unit; commit; worklog row
  "A5 done + Track A complete". (e2e deferred by decision — note it in the worklog row.)

## Phase 0c — Amend the roadmap plan.md in place (+ Revision Log + worklog RE-PLAN row) — DONE (e051ced)

Fold these 8 validated corrections into `plans/2026-07-05-platform_knowledge_publishing_roadmap/plan.md`:

1. **B1 — sort & unique guards.** The sort path uses a scalar correlated subquery with no
   LIMIT/aggregate (`src/db/queries/documents.ts:195`) — multi-valued fields would sort on an
   arbitrary row. Reject `sort` on multi-valued relation fields in `assertIndexed`-adjacent
   validation (or use MIN/MAX later). Also reject `unique: true` on a `multiple` relation
   (all index rows share one `unique_key` → false collisions; nothing stops it today).
2. **B1 — builder config gap.** `parseCollectionForm` (`src/components/admin/collection-builder.tsx:93`)
   hardcodes per-field config to `select` only. Add a relation config branch (target-collection
   picker + `multiple` + `titleField`), or relations are REST/MCP-authorable only. Also give
   relation an explicit `jsonSchema` (clean id-string schema) rather than relying on
   `z.toJSONSchema` derivation.
3. **B2 — batch loader is net-new.** No `getDocumentsByIds` exists (`inArray` not even imported
   in `src/db/queries/documents.ts`). Add a Grant-scoped batch query (pattern precedent:
   `src/access/authorize.ts:175`, `src/db/queries/grants.ts:46`).
4. **B3 — backlinks need a new access-gated query.** `isIndexValueTaken` is access-blind by
   design and filters by collection+fieldKey; `listBacklinks` must join `documents` and apply
   the same access/status narrowing as the list path (`documents.ts:175-204`). "Same WHERE
   shape" is a template, not a reuse.
5. **B4 — reframe as visibility opt-out.** Status is load-bearing in the access layer
   (`Condition='own'|'published'`, publicRead sugar, seeded reader/anonymous policies) — 
   `lifecycle:'none'` gates the publish *affordances* + `initialStatus`, it does not remove
   status. Prereq: extend `WORKFLOW_SCHEMA` (`src/services/collections/index.ts:33`, strictObject
   rejects unknown keys). Add the missed location: MCP `list_` status enum (`src/mcp/tools.ts:110`)
   alongside `src/lib/openapi.ts:37`.
6. **B5 — defer until after Track C** (not needed by any end-to-end acceptance flow). Annotate
   its real scope: composites work as self-contained field types (Zod nests; MCP/OpenAPI free),
   but nested indexing/filter/sort, nested PATCH merge (top-level replace only), form recursion,
   and builder authoring are all absent and must be budgeted or explicitly out-of-scope.
7. **C2 — public error handling + reserved slugs + CSP.** Global `onError` (`src/main.tsx:64-99`)
   redirects browser 403s to `/admin` and renders 404s as JSON — public routes need public 404/403
   rendering (route-level or an `onError` branch). Add `RESERVED_COLLECTION_SLUGS`
   (`admin, api, auth, media, mcp, s, vendor`) to collection validation
   (precedent: `RESERVED_FIELD_KEYS` in `src/config/constants.ts`) — a collection slug `media`
   would be shadowed by static routes. Note CSP (`src/main.tsx:28-52`) is admin-tuned:
   `img-src 'self' data:` blocks remote images on public pages; `frame-ancestors 'none'` blocks
   embedding — acceptable for now, note as a future knob.
8. **C3 — no migration; explicit `'link'` branch.** Delete the "item_grants subjectKind widening
   migration" from cross-cutting notes (no CHECK constraint exists — code-only). Grant matching:
   add a `'link'` branch to `getApplicableGrants` + `getGrantedDocumentIds`
   (`src/db/queries/grants.ts:43-48, 64-81`) and widen the TS unions
   (`grants.ts:15,26`; `src/services/access/index.ts:151`) — do **not** disguise links as
   `subjectKind='principal'` (keeps the access matrix honest). Reuse `generateToken`/`hashToken`
   (`src/lib/token.ts`) + the invite-token validity/consume pattern (`src/db/queries/invites.ts`).

Also amend the roadmap's per-phase "Docs/tests" lines: e2e items move to the final consolidated
pass (user decision); unit tests stay per-phase.

## Phases B1 → B3, B4, C1 → C3 — execute the amended roadmap — DONE (6d560e0…07f28e4; B5 deferred)

Follow the roadmap plan.md per phase (it already carries correct file:line detail, now corrected
per Phase 0c). Summary of the execution chain, with the validated key facts:

- **B1 (keystone):** `toIndex` contract (`src/fields/types.ts:114`) → allow
  `string | number | Array<string|number> | null`; `buildIndex`
  (`src/services/documents/index.ts:112-130`) emits one `IndexValue` per element (scalars
  unchanged — all 9 existing implementers keep working; sync layer already delete-then-inserts
  arbitrary `IndexValue[]`). New `src/fields/relation.tsx` mirroring `media.tsx` (`/^doc_[A-Za-z0-9_-]+$/`,
  format-only, ≤64 chars; `value_text` routing is automatic — `NUMERIC_INDEX_TYPES` untouched);
  register in `src/fields/registry.ts` (validation/MCP/OpenAPI/type-dropdown pick it up with
  zero allowlist edits — verified). Builder config branch + guards per corrections 1–2.
- **B2:** `getDocumentsByIds` query (Grant-scoped, `inArray`); `expandRelations` step in
  `getDocument` (after `src/services/documents/index.ts:172`) and `listDocuments` (after :263-276
  row fetch); attach `{id, title, collection}`, dangling → `{id, title: null}`; `titleField`
  config with first-text/slug-field inference. REST/MCP inherit the expanded shape.
- **B3:** access-gated `listBacklinks` query (correction 4) + `getBacklinks` service
  (`authorize('read')`); admin "Referenced by" panel, REST `/api/c/:collection/:id/backlinks`,
  MCP `backlinks_<slug>` tool (couldDo-gated, mirroring `share_<slug>` in `src/mcp/tools.ts`).
- **B4:** `WORKFLOW_SCHEMA` + type extension `{draftPublish?, lifecycle?: 'publish'|'none'}`;
  `initialStatus` (index.ts:156) → published when `'none'`; hide Status column
  (`src/components/admin/generated.tsx:120-142`); suppress publish button (editor-sidebar already
  gates on `draftPublish`), `publish_<slug>` tool (`src/mcp/tools.ts:154-161`), REST publish route
  + status filter (openapi.ts:37, tools.ts:110). Strip cosmetic post-isms
  (`collection-builder.tsx:317,329`, `slug.tsx:73`, seed `defaultAuthorName` reframe).
- **C1:** pick a Workers-safe markdown renderer + sanitizer (no md/sanitizer dep exists today —
  evaluate `marked` + sanitize pass vs a minimal safe renderer; raw HTML disabled) in
  `src/lib/markdown/`. Add `ViewComponent?: FC<FieldViewProps>` to `FieldType`
  (`src/fields/types.ts`, default safe escaped text); implement for markdown/relation/media/
  select/tags/datetime. Unit test: XSS payload neutralized.
- **C2:** `getDocumentBySlug` service+query (indexed slug filter, published-only);
  public route `src/routes/[collection]/[slug]/index.tsx` (no 2-segment conflict — verified;
  static routes win) using the anonymous-principal path (`resolvePrincipal` already returns one;
  `authorize`/`compileReadFilter` already enforce publicRead+published); `PublicLayout` as an
  inner component under the **already-global** `RootLayout` (`src/main.tsx:58` — Datastar+Tailwind
  free; no admin chrome; `getSettings` masthead is the sanctioned un-gated read,
  `src/services/settings/index.ts:43`); public 404/403 rendering + reserved slugs per correction 7;
  admin read-only detail view reusing `ViewComponent`s.
- **C3:** `'link'` grant branch per correction 8; `createShareLink` service
  (`authorize('manage_access')`, plaintext-once like `issueToken`,
  `src/services/access/index.ts:299-320` precedent); public `src/routes/s/[token]/index.tsx`
  resolving token-hash → synthetic link principal → existing grant machinery → render via C2;
  revoke/expiry honored (non-expiry filter already in `getApplicableGrants`); "Share by email"
  via the stubbed transport; share-panel UI additions (create/copy/revoke, expiry).
- **B5 (deferred, last, optional):** self-contained `object`/`repeater` composite types per
  correction 6 — reassess scope after C3 ships.

Each phase: unit tests + steering-doc updates travel with the code (SCHEMA_ENGINE for B1/B4/B5 +
ViewComponent seam, API_AND_MCP for B2/B3 shapes + tools, SECURITY for C1 XSS + C3 tokens,
ACCESS_CONTROL for C3 link grants, DESIGN_SYSTEM/A11Y for C2 public layout). TECH_DECISIONS
D21–D23 flip from "accepted" to "implemented" as they land. Worklog row + commit per phase.

## Final phase — consolidated verification & e2e — DONE (5bec702)

1. **Decide the e2e harness once, here** (deferred flake decision): recommend pointing Playwright
   `webServer` at a built preview (`wrangler dev` / `vite preview` on the Workers build) instead
   of `vite dev` — the axe-sweep flake was diagnosed as vite-dev degradation under sustained
   load, not a real violation. Fallback: keep `vite dev` + document the flake.
2. Write/extend e2e specs for the new flows and run the full suite green (reset D1 first:
   `pkill` stale server, `rm -rf .wrangler/state/v3/d1`, `db:migrate && db:seed && db:seed:e2e`).
3. Drive the roadmap's end-to-end acceptance list (plan.md "Verification" section): access
   legible; any-data collection with relations + lifecycle-none; graph traversal via admin, REST
   `/backlinks`, MCP `backlinks_*`; public rendered page (markdown rendered, relations as links,
   draft 404s anonymously); share link grants/revokes anonymous read of a non-public item +
   email-share logged by the stub; all three surfaces gated + audited.
4. `bun run build` clean; `/wrap-up` (finalize plan artifacts, propagate docs/lessons).

## Verification (how each stage proves itself)

- **Phase 0:** docs-only — proofread cross-references (CLAUDE.md ↔ brief ↔ roadmap pointers);
  `git mv` folder rename preserves history; no code touched, type-check still 0 as a smoke check.
- **Phase 0b:** `bun run type-check && bun run lint && bun run test:run` (expect 179 green) before
  the commit.
- **B/C phases:** unit tests per phase (multi-row index emission; relation validation; expansion
  incl. dangling target; backlink round-trip A→B ⇒ B lists A, access-scoped: a reader who can't
  read A doesn't see the backlink; lifecycle-none initial status + suppressed tooling; XSS
  neutralized; slug lookup published-only; link grant: valid/expired/revoked). Quick manual drive
  on `bun run dev` @ 127.0.0.1:3100 for each admin surface (dev admin: admin@remill.local /
  remilladmin).
- **Final phase:** full e2e + axe + the 6-point acceptance drive above.
