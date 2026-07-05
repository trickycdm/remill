# remill — Platform & Knowledge Roadmap

## Context

remill's storage-and-authorization **core** is excellent, but three of the user's
observations all trace to the same root cause: **the power is in the model/services;
the surfaces that make it legible and usable are missing.** Five deep-dive analyses
confirmed:

1. **Access is hard to manage** — the `authorize()` engine, custom roles, per-doc
   `item_grants`, expiring grants, and per-collection token scopes all exist in the
   data model + `src/services/access/index.ts`, but have **no admin screens**. You
   can't even add a second human through the product (only the bootstrap CLI). The
   three personas (Person / Service / Agent) collapse into two `kind`s (`user` |
   `agent`), so a data-pulling *system* and an *AI agent* are indistinguishable.
2. **It feels "post"-centric** — but the engine is genuinely general-purpose (no blog
   collection even ships; "posts" is only a test fixture). The felt narrowness is
   cosmetic dressing + a universal publish/author lifecycle forced on every record.
   The **real** gap is missing `relation`, `repeater`, and `object` field types — you
   can store the *nodes* of a knowledge graph but not the *edges*.
3. **Not enough for publishing/connecting knowledge** (à la html.surf) — no
   record→record links/backlinks (the graph), no human-readable rendered output
   (JSON only, even in admin), and the item-grant sharing engine is wired to no
   surface and can't reach someone without an account.

**Goal:** make remill a **general, secure, agent-native headless CMS/data platform**
whose access is legible, whose schema models any structured/relational data, and which
can publish & securely share interconnected knowledge across **MCP, REST, and rendered
HTML pages**. The work is almost entirely **additive** — the secure core (compile-time
`Grant` witness, append-only audit, hashed scoped tokens, one `decide()`) is preserved
untouched.

**Decisions taken (this planning session):**
- Personas → **lightweight `subtype`** over the existing human/machine axis (not a new
  security kind).
- Outsider sharing → **both token-links and email** — build token-links fully now,
  **stub the email transport** now and integrate a real provider later.
- Knowledge consumers → **all of it**: MCP, REST, and the **full render engine**.

---

## Key design decisions (read before executing any phase)

- **Personas via `subtype`, not a new `kind`.** Add nullable `principals.subtype`.
  Security stays on `kind` (`user` = human, `agent` = machine); `subtype` ∈
  {`person`, `service`, `agent`} is display/grouping/filtering only. A "service" is a
  machine principal — `refuseAgentEscalation` (checks `kind==='agent'`,
  `src/services/access/index.ts:46`) already blocks it from `manage_access`, which is
  correct. Non-breaking; backfill existing agents → `subtype='agent'`.
- **Relations reuse `document_index`, not a new edges table.** A relation value is a
  target `doc_…` id stored as an index row (`value_text`), exactly like `media`
  (`src/fields/media.tsx:21-31`). Backlinks are the *same* reverse-lookup WHERE shape
  already implemented in `isIndexValueTaken` (`src/db/queries/documents.ts:219-244`).
  One indexing path, backlinks "for free."
- **Multi-relations require one engine change:** extend the `toIndex` contract
  (`src/fields/types.ts:115`) + `buildIndex` (`src/services/documents/index.ts:112-130`)
  to allow **emitting multiple index rows** (return `Array<string|number>`), so each
  edge is independently reverse-lookupable. Additive; scalar returns unchanged.
- **Relation read-expansion happens in the service layer, not `beforeRender`.**
  `beforeRender` exists but is unwired, and its `RenderCtx` has no DB access
  (`src/fields/types.ts:75-79`). Add an `expandRelations` step in the documents-read
  service that batch-loads each target's **display title** (first text/`slug` field,
  or an optional `titleField` on the collection). Attach `{ id, title, collection }`.
- **Share links reuse `item_grants`.** Add `subjectKind = 'link'` (hashed link token
  as `subjectId`). The public share route resolves a valid token → an anonymous
  principal carrying that link identity → the existing `getApplicableGrants` /
  `compileReadFilter` machinery grants the scoped read. Email-share = the same link
  delivered via the stubbed transport. No parallel permission system.
- **Add an optional `ViewComponent` to the FieldType contract** for read/detail/public
  surfaces (markdown→HTML, relation→link, media→`<img>`), defaulting to a safe text
  render. This is the render seam the public pages and admin detail view use.
- **Preserve the invariants:** every new read/write still routes routes→services→
  queries and passes `authorize()` → `Grant`. New MCP tools use `couldDo` visibility
  gating. New public reads use the sanctioned un-gated `getSettings` + anonymous
  `authorize('read')` path only.

---

## Execution order

Start with **Track A (Access)** per the user's steer — lowest risk, highest "I can
finally see it," and it unblocks sharing. Then **Track B (relational data + graph)** —
the keystone. Then **Track C (render + publish + share links)**. Phases are sequenced
by dependency; each ships green (0 type / 0 lint / unit + e2e / build) with its own
commit, worklog rows, and steering-doc updates.

---

## TRACK A — Access legibility & management

### Phase A1 — Personas: `subtype` + persona-clear Access UI
- **Migration:** add `principals.subtype TEXT` (nullable); `db:generate` + reviewed SQL
  backfill (`UPDATE principals SET subtype='agent' WHERE kind='agent'`;
  `='person' WHERE kind='user'`). Update `src/db/schema.ts:47-53`.
- **Service/query:** `createAgent` (`src/services/access/index.ts:187`) takes a
  `subtype: 'service' | 'agent'`; thread through `createAgentPrincipal`
  (`src/db/queries/principals.ts:42`). Principal resolution (`src/lib/api-auth.ts`,
  session) carries `subtype` for display (security stays on `kind`).
- **UI:** `src/routes/admin/access/index.tsx` + `agents.tsx` — group principals into
  three sections (People / Services / Agents), badge by subtype, and let "New machine
  identity" pick Service vs Agent. Reuse `Badge`, `Card`, `Table` from `@/components/ui`.
- **Docs/tests:** ACCESS_CONTROL.md (persona model); unit test subtype persistence;
  e2e: create a Service and an Agent, assert distinct badges.

### Phase A2 — Invite / create a human (the sharpest gap)
- **Query (new):** `createUserPrincipal(db, {name, email, passwordHash}, now)` in
  `src/db/queries/principals.ts` — atomically insert principal (`kind='user'`,
  `subtype='person'`) + `users` row (mirror the three-row pattern in
  `scripts/bootstrap-admin.ts`). Add `getUserByEmail` guard for duplicates.
- **Service (new):** `createUser(db, principal, {name, email, password?, role}, now)` in
  `src/services/access/index.ts` — `refuseAgentEscalation` + `authorize('manage_access',
  ROOT)`, hash via `hashPassword` (`@/lib/password`), assign an initial role
  (default `reader`). **Two paths:** (a) admin sets an initial password directly
  (fully works now); (b) email invite → generate a single-use set-password token +
  "send" via the **stubbed** transport (Phase A2b).
- **Email stub (A2b):** new `src/lib/email/` — `EmailTransport` interface
  `send({to, subject, html})` + `ConsoleEmailTransport` (logs the link) selected by env;
  real provider (Resend/MailChannels) is later work. New `invite_tokens` table
  (single-use, expiring) + `src/routes/auth/set-password/[token].tsx` to consume it.
- **UI/route:** "Invite person" form on `/admin/access` + sibling POST route
  (`src/routes/admin/access/users.tsx`), following the `agents.tsx`/`assign.tsx` pattern.
- **Docs/tests:** SECURITY_STANDARDS.md (invite flow, stubbed email); unit (createUser,
  refuseAgentEscalation, dup-email); e2e: invite a person with a direct password, log in
  as them.

### Phase A3 — Surface the hidden capabilities
- **Custom-role CRUD screen:** new `/admin/access/roles` + `roles/[slug]` — list,
  create, edit, delete. Services already exist (`createRole`/`updateRole`/`deleteRole`,
  `src/services/access/index.ts:69-110`); build screen + routes only. Compose
  permissions from the closed action/condition vocab.
- **Per-collection token scoping:** widen the issue form + rewrite `parseScope`
  (`src/routes/admin/access/tokens.tsx:15`) to emit real `{collection, action}` masks
  (a collection multiselect × action checkboxes) instead of the hardcoded `collection:'*'`
  presets. `issueToken` already accepts the scope (`access/index.ts:203`).
- **Item-grant "Share" surface** (in-system principals/roles):
  - Admin: a "Share" action on the document edit view → `grantItem`/`revokeItem`
    (`access/index.ts:138-171`), listing active grants with expiry.
  - REST: `src/routes/api/c/[collection]/[id]/grants.tsx` (`onRequestPost`/`onRequestDelete`).
  - MCP: `share_<slug>` tool in `buildToolsForPrincipal` (`src/mcp/tools.ts`), gated by
    `couldDo(perms, principal, 'manage_access', slug, false)`.
- **Docs/tests:** API_AND_MCP_STANDARDS.md (grants endpoint + tool), ACCESS_CONTROL.md
  (roles UI, token scoping); unit + e2e for each.

### Phase A4 — One place to see "who/what can touch what"
- **Consolidated access view** on `/admin/access`: a reverse matrix (collection ×
  principal → effective actions) built from `getPrincipalPermissions` + role_permissions;
  show each principal's token scopes and active item-grants inline (today invisible after
  creation). Read-only aggregation; no new services beyond a read/compose helper.
- **Docs/tests:** ACCESS_CONTROL.md (the access overview); e2e snapshot of the matrix.

### Phase A5 — Remove the dead per-collection access map
- The collection `access: { <role>: [actions] }` map is validated + stored + **never
  read** by `decide()` (only `publicRead` is) — a security smell. **Recommended:**
  tighten `ACCESS_SCHEMA` in `src/services/collections/index.ts:31-33` to accept
  **only** `publicRead`, reject/strip role→action maps on write, and document
  `role_permissions` as the single collection-scoping mechanism. No data migration
  needed (the map was inert). Update SCHEMA_ENGINE.md + ACCESS_CONTROL.md.

---

## TRACK B — Relational data & the knowledge graph

### Phase B1 — Engine: multi-value index + relation field (the keystone)
- **Engine change:** allow `toIndex` to return `Array<string|number>`
  (`src/fields/types.ts:115`); `buildIndex` (`src/services/documents/index.ts:112-130`)
  emits one `document_index` row per element. Scalar returns unchanged (non-breaking).
- **New field `src/fields/relation.tsx`** (register in `src/fields/registry.ts:20-33`):
  - `configSchema`: `{ collection: string (target slug), multiple?: boolean,
    titleField?: string }` (`.strict()`).
  - `valueSchema`: `doc_…`-format id (regex, mirror `media.tsx:21-25`), or `string[]`
    when `multiple`; `requiredNonEmpty` semantics; **format-only** (existence resolved
    on read, not validate — matches the media precedent).
  - `toIndex`: the id, or the id array (uses the new multi-emit).
  - `EditComponent`: a target picker (search/select documents of the target collection);
    `CellComponent`/`ViewComponent`: render the resolved title as a link (see B3).
- **Docs/tests:** SCHEMA_ENGINE.md (relation type, multi-index contract); unit
  (validation, single + multi index rows written); collections-validation gate accepts
  it with zero allowlist edits.

### Phase B2 — Relation read-expansion across all surfaces
- **Service:** `expandRelations` step in the documents-read path
  (`getDocument`/`listDocuments`, `src/services/documents/index.ts:164-282`) — collect
  relation fields, batch-load targets' display titles (first text/`slug` field or
  configured `titleField`), attach `{ id, title, collection }`; unresolved/deleted →
  `{ id, title: null }` (graceful dangling). Title read is `authorize()`-scoped.
- **Surfaces:** REST + MCP include the expanded shape; admin list cell + the new detail
  `ViewComponent` render title links. Add optional `titleField` to `CollectionDefinition`
  with a sensible inferred default.
- **Docs/tests:** API_AND_MCP_STANDARDS.md (expanded relation shape); unit + e2e:
  create A referencing B, read A, assert B's title present; delete B, assert graceful null.

### Phase B3 — Backlinks / the graph
- **Query (new):** `listBacklinks(db, grant, targetDocId)` beside `isIndexValueTaken`
  (`src/db/queries/documents.ts:219`) — reverse WHERE on `document_index`
  (`value_text = targetDocId` across relation fields) → source doc ids → hydrate.
- **Service:** `getBacklinks(db, principal, collection, id, now)` — `authorize('read')`,
  returns witnessed source docs (respects the reader's permissions).
- **Surfaces:** admin "Referenced by" panel on the edit/detail view; REST
  `/api/c/:collection/:id/backlinks`; MCP `backlinks_<slug>` tool (read-gated). This is
  the traversable graph.
- **Docs/tests:** SCHEMA_ENGINE.md / API_AND_MCP_STANDARDS.md; unit + e2e round-trip
  (A→B link produces B's backlink to A).

### Phase B4 — Per-collection lifecycle opt-out + strip cosmetic post-isms
- **Lifecycle opt-out:** extend `workflow` to `{ draftPublish?: boolean; lifecycle?:
  'publish' | 'none' }`. When `lifecycle:'none'`: `initialStatus`
  (`src/services/documents/index.ts:156`) → always available; generated list hides the
  **Status** column (`src/components/admin/generated.tsx:120-142`); no publish
  button/`publish_<slug>` tool; REST omits the `status` filter
  (`src/lib/openapi.ts:37`). Keep the `documents.status` column (defaults published) —
  suppress UI/tooling only. A "Company"/"Person" record stops looking like a draft blog post.
- **Strip dressing:** `collection-builder.tsx:317,329` ("Blog posts"/"posts"),
  `slug.tsx:73` ("my-post-slug"), reframe `defaultAuthorName` (`seed.sql:55`) as an
  optional convention. Cosmetic, ~30 min.
- **Docs/tests:** SCHEMA_ENGINE.md (lifecycle modes); unit + e2e: a lifecycle-`none`
  collection renders no Status column and exposes no publish tool.

### Phase B5 — `repeater` + `object` composite field types
- **`src/fields/object.tsx`** (nested group of sub-fields) and **`src/fields/repeater.tsx`**
  (array of a sub-field set), composing existing field types recursively. Config carries
  the sub-`FieldDescriptor[]`; `valueSchema` builds a nested/`array` Zod object; nested
  edit UI. Non-indexable at the composite level (like `json`) but far more structured —
  closes the "nested structured records" gap without the untyped `json` escape hatch.
- **Docs/tests:** SCHEMA_ENGINE.md; unit (nested validation, whitelist still rejects
  undeclared sub-keys); e2e authoring a repeater.

---

## TRACK C — Publish & connect (the render engine)

### Phase C1 — Markdown→HTML renderer + field `ViewComponent`
- **Renderer:** add a Workers-safe markdown renderer with **raw HTML disabled** +
  a sanitize pass (evaluate `marked` + a sanitizer, or a minimal safe renderer) in
  `src/lib/markdown/`. Wire a `render(md): string` used only on read/detail surfaces.
- **Contract:** add optional `ViewComponent?: FC<FieldViewProps>` to `FieldType`
  (`src/fields/types.ts`), default = safe escaped text. Implement for `markdown`
  (→ sanitized HTML), `relation` (→ title link), `media` (→ `<img>`/player),
  `select`/`tags`/`datetime` (formatted).
- **Docs/tests:** SCHEMA_ENGINE.md (ViewComponent seam), SECURITY_STANDARDS.md (XSS:
  sanitize + no raw HTML in markdown); unit: XSS payload in markdown is neutralized.

### Phase C2 — Public rendered read pages + admin detail view
- **Slug lookup:** `getDocumentBySlug(db, principal, collection, slug, now)` service +
  query (uses the indexed `slug` filter path, published-only). Fall back to `/{collection}/{id}`
  when a collection has no slug field.
- **Public route:** `src/routes/[collection]/[slug]/index.tsx` `onRequestGet`, **no
  auth**, `anonymousPrincipal('rest')`; `authorize('read')` + `compileReadFilter` already
  enforce publicRead + published-only (drafts structurally invisible). 404 otherwise.
- **Public layout (new):** `PublicLayout` reusing `RootLayout` (`src/layouts.tsx:18`) +
  `getSettings` masthead (siteName/description — the sanctioned un-gated read,
  `src/services/settings/index.ts:43`). Render fields via `ViewComponent`; relations
  render as links to their public pages → **the graph becomes navigable**; optional
  "Referenced by" (B3) shown.
- **Admin detail view:** a read (non-edit) document view reusing the same `ViewComponent`s.
- **`/` behavior:** optionally replace the bare `/admin` redirect
  (`src/routes/index.tsx:11`) with a minimal public index (deferred/optional).
- **Docs/tests:** DESIGN_SYSTEM.md + A11Y_STANDARDS.md (public layout, WCAG); e2e + axe:
  published+publicRead doc renders publicly; a draft / non-publicRead doc 404s anonymously.

### Phase C3 — Share links (token) + email-share (stubbed)
- **Model:** extend `item_grants.subjectKind` to allow `'link'`; `subjectId` = hashed
  link token. New service `createShareLink(db, principal, {collection, documentId|null,
  actions, expiresAt}, now)` → `authorize('manage_access', {collection, documentId})`,
  returns the plaintext token once (like API tokens). Reuse `grantItem` plumbing.
- **Consumption:** public route `src/routes/s/[token]/index.tsx` (+ an API/JSON variant
  and MCP resource): resolve + verify the token → construct an anonymous principal
  carrying the link identity so `getApplicableGrants`/`compileReadFilter`
  (`src/access/authorize.ts:107-175`) grant the scoped read of an **otherwise non-public**
  item; render via C2. Expiry + revoke honored.
- **Email-share:** a "Share by email" action reuses `createShareLink` + the **stubbed**
  `EmailTransport` (A2b) to deliver the link (logged now; real provider later).
- **UI:** share-link management (create/copy/revoke, show expiry) on the document Share panel.
- **Docs/tests:** ACCESS_CONTROL.md (link subject kind), SECURITY_STANDARDS.md (token
  hashing, expiry, revoke); unit + e2e: link grants read to an anonymous visitor;
  expired/revoked link 404s; non-shared item stays private.

---

## Cross-cutting notes
- **Migrations:** A1 (`principals.subtype`), A2 (`invite_tokens`), C3 (`item_grants`
  subjectKind widening) each need a reviewed migration (`bun run db:generate` +
  hand-add CHECK/indexes per DATABASE_STANDARDS.md). Never edit an applied migration.
  Re-seed note per `docs/DEPLOY_CHECKLIST.md`.
- **Steering updates travel with each phase** (SCHEMA_ENGINE, ACCESS_CONTROL,
  SECURITY_STANDARDS, API_AND_MCP_STANDARDS, DESIGN_SYSTEM, A11Y). Run `/learn` +
  `/wrap-up` at the end.
- **Plan lifecycle:** on approval, relocate this to
  `plans/2026-07-05-platform-and-knowledge/plan.md` with a `worklog.md`; append a row
  per meaningful step; re-plan in place (never a new file).

---

## Verification (per phase + end-to-end)
For **every** phase: `bun run type-check` (0), `bun run lint` (0), `bun run test:run`
(green), `bun run e2e` (green, incl. axe), `bun run build` (clean). Reset local D1 if
e2e collides: `rm -rf .wrangler/state/v3/d1`.

**End-to-end acceptance (the whole roadmap), driven on `bun run dev` @ 127.0.0.1:3100
plus REST/MCP:**
1. **Access legible:** create a Person, a Service, and an Agent (distinct in the UI);
   mint a custom role; scope a token to one collection; see it all in the access matrix.
2. **Any-data:** define a non-content domain (e.g. `companies` + `people` with a
   `relation`), lifecycle-`none`, no Status column, no publish tooling — via the admin
   builder **and** via MCP `create_collection`.
3. **Graph:** a Person references a Company; read the Person (title expanded); open the
   Company and see the Person under "Referenced by"; traverse the same graph via MCP
   `backlinks_*` and `GET /api/c/.../backlinks`.
4. **Publish:** mark a doc published on a `publicRead` collection; open
   `/{collection}/{slug}` anonymously and read rendered HTML (markdown rendered, relations
   as working links); confirm a draft 404s anonymously.
5. **Share:** create a share link for a **non-public** item; open it in a logged-out
   browser and read it; revoke it and confirm 404; trigger "share by email" and confirm
   the stubbed transport logged the link.
6. **All three surfaces** exercised end-to-end (admin SSR, REST JSON, MCP tools) on the
   same content, each permission-gated and audited.
