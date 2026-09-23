# Document review — anchored comments, review links, agent-readable feedback (D54–D55)

**Status: BUILT (Parts 1–6) — 2026-09-23. Deviations from this plan are logged as RE-PLAN rows in `worklog.md`.**

## Context

Colin publishes rich documents (prose + charts + scripted HTML) and wants people to **mark them up**:
select words or click a figure, leave a comment, reply in threads. Two audiences:

- **Team reviewers**, reached by link, no account required. Either a **personal link** per preset
  reviewer (comments attributed automatically) or an **open link** where they type their name once.
- **Colin himself** while drafting — notes addressed to the agent.

The consumer of the feedback is a **coding-session agent** that pulls the document + comments over
MCP, proposes changes, and — after Colin approves — edits the document and resolves the threads it
addressed. No autonomous actions on the page; the human is the gate.

Edits come from **both** the agent (MCP `update_<slug>`) and the admin GUI. Today updates are
last-write-wins: `updateDocument` (`src/services/documents/index.ts:1061`) computes `MAX(revision)+1`
outside the batch with no staleness check, so an agent working from rev 5 can silently overwrite a
GUI edit made at rev 6. A concurrent collision already trips `document_revisions_doc_rev_unique`
but surfaces as the wrong message ("unique field value taken", catch at :1128). This must be fixed
first — it's also what lets "resolved in rev N" mean something.

### Decisions settled in conversation
- Annotation works on **shell-mode** pages: remill owns the frame + overlay; author content (the D25
  `html` field, markdown) renders inside a known annotatable region, scripts intact. Raw mode
  (D27) is out of scope.
- Anchors: **text** (quote + prefix/suffix + offset + field key) and **block** (`data-rm-anchor`
  elements — charts, images, widgets), plus **document-level** general comments. Every comment
  records the revision it was made against.
- **Flat threads** (root + replies, no nesting). Resolve/reopen is per thread and stamps the revision.
- **Visibility**: principal comments are `internal` (principals only) or `shared`. Reviewer
  comments take visibility **live from their link's mode** — `group` (all group reviewers see) or
  `individual` (that reviewer + owners). Flipping a link's mode flips its past comments too, behind
  a warning with counts. Replies follow their root.
- Reviewers on individual links see a notice that the owner may later share their comments.

---

## Part 1: Optimistic concurrency (D54)

### 1a. Service (`src/services/documents/index.ts`)
- `updateDocument` gains optional `opts.expectedRevision`. When present: pre-check
  `current = nextRevisionNumber - 1`; mismatch → `StaleRevisionError` (new, extends `ConflictError`
  in `src/lib/errors.ts`, code `STALE_REVISION`, details `{expected, current}`). Write the new
  revision as `expectedRevision + 1`, so two writers based on the same revision collide on the
  existing `(document_id, revision)` unique index — the atomic backstop, **no migration needed**.
- Distinguish that index's failure from field-uniqueness in the catch (:1128) → `StaleRevisionError`
  even without `expectedRevision` (fixes the misleading message today).
- `DocumentRecord` gains `revision` (current). `getDocument`/list queries select it via
  `MAX(document_revisions.revision)` subquery (`src/db/queries/documents.ts`); `updateDocument`,
  `setPublished`, `restoreRevision` return it.
- `expectedRevision` is stripped by callers before `whitelistOnly` (it's not a field).

### 1b. Surfaces
- **MCP** `update_<slug>` (`src/mcp/tools.ts:449`): add `expectedRevision` (integer) to the input
  schema; description tells agents to pass the revision from `get_<slug>`. Stale → `isError` result
  with `{code:'STALE_REVISION', expected, current}` via the existing handler mapping.
- **REST** `PATCH /api/c/:collection/:id`: `If-Match: "<rev>"` → expectedRevision; `GET` returns
  `ETag: "<rev>"`. 409 `STALE_REVISION` via `main.tsx` `onError`. OpenAPI (`src/lib/openapi.ts`).
- **Admin** edit form (`src/components/admin/generated.tsx`, POST at
  `src/routes/admin/c/[collection]/[id]/index.tsx:199`): hidden `_revision` input, read before
  `coerceAdminForm`. Stale → `renderSaveError` message "This document changed since you opened it
  (rev X → Y)" with links to the revision diff viewer (D39) and a reload.
- Imports (`src/services/transfer`) and settings keep no-expectation behaviour.

### 1c. Tests
Service: matching/mismatched/absent expectedRevision; simulated race (two updates from same base)
→ second gets `STALE_REVISION`; field-unique conflict still reports the field message. REST ETag /
If-Match round trip; MCP stale error shape.

---

## Part 2: Comments + review links — data and access (D55)

### 2a. Migration `0017_*` (edit `src/db/schema.ts`, `bun run db:generate`, hand-add CHECKs)
- **`comments`** — `id` (`cmt_`), `document_id` FK→documents **cascade**, `thread_id` (null on
  roots; root id on replies, FK→comments cascade), author: `author_principal_id` (nullable FK) |
  `reviewer_id` (nullable FK→review_reviewers **set null**, name snapshot kept in `author_name`),
  CHECK exactly one; `visibility` CHECK(`internal`,`shared`) nullable — set only on principal roots;
  `anchor_json` (roots only: `{kind:'text',field,quote,prefix,suffix,start}` |
  `{kind:'block',field,blockId}` | `{kind:'document'}`), `anchor_revision`, `anchor_status`
  CHECK(`anchored`,`outdated`); `body` TEXT (plain text, ≤4000 chars); `intent`
  CHECK(`must_fix`,`question`,`suggestion`,`nit`,`praise`) nullable; `status`
  CHECK(`open`,`resolved`) on roots; `resolved_by`, `resolved_revision`, `resolved_at`;
  `created_at`. Indexes: `(document_id, created_at)`, `(thread_id)`.
- **`review_reviewers`** — `id` (`rvw_`), `grant_id` FK→item_grants **cascade**, `name`, `email`
  nullable, `kind` CHECK(`invited`,`self_named`), `done_at` nullable, `created_at`.
- **`item_grants.review_mode`** — nullable CHECK(`group`,`individual`); null = plain read link.
- Add both tables to the fixed-table list in `steering/DATABASE_STANDARDS.md`.

### 2b. Access (`src/access/`)
- New action **`comment`** in `ACTIONS` (`types.ts:13`), `ALL_ACTIONS` (`policy.ts:23`), `seed.sql`;
  granted to admin, editor, author roles. Covers create/reply/resolve/reopen for principals.
- Reviewers authorize through the **existing item-grant path unchanged**:
  `{...anonymousPrincipal('rest'), linkId}` + action `comment` on a link grant whose
  `actions_json` includes it. `decide()` untouched.
- The Grants-section checkbox list (`share-panel.tsx:285`) picks `comment` up automatically; keep
  it — principal/role/team item grants legitimately confer commenting.
- ACCESS_CONTROL.md: document `comment`, and that link-borne `comment` is **the first anonymous
  write** — bounded to one document, inert body, rate limited, revocable.

### 2c. Service `src/services/comments/index.ts` (queries in `src/db/queries/comments.ts`)
- `createComment(db, actor, docRef, {anchor, body, intent, visibility?}, now)` — actor is a principal
  or a `ReviewerActor {linkId, reviewerId}`; authorizes `comment`; validates anchor against the
  **current revision's canonical text** (Part 3): quote found → text anchor; not found (e.g.
  script-generated text) → downgrade to the nearest enclosing block anchor, else document-level.
- `replyToThread`, `resolveThread`/`reopenThread` (principals only; stamp revision),
  `deleteComment` (own only; deleting a root deletes the thread).
- `listComments(db, viewer, docRef, filters)` — visibility rule:
  principals see all; reviewer R sees own threads + `shared` principal threads + (if R's link is
  `group`) threads from other `group`-mode links' reviewers. Replies follow roots.
- `markReviewerDone`, `createReviewLink` (wraps `createShareLink`, `src/services/access/index.ts:237`,
  with `actions:['read','comment']`, `review_mode`, and for personal links an `invited` reviewer
  row; optional invite email via the `emailShareLink` path), `previewModeFlip` (returns
  `{comments, reviewers}` counts that would change visibility) + `setReviewMode`.
- Events: add `comment.created`, `comment.resolved`, `comment.reopened` to `EventInput.type`
  (`src/db/queries/events.ts:17`) and the schema comment; `eventInsert` inside each mutation batch.
- Rate limits (`src/middleware/rate-limit.ts`): `COMMENT_POST` per IP + `COMMENT_POST_LINK` per link
  hash — copy the two-bucket unlock pattern (`src/routes/s/[token]/index.tsx:197`).

---

## Part 3: Canonical text + server-side re-anchoring

### 3a. `src/lib/anchor/` (pure, unit-tested in Node vitest)
- `canonicalText(fieldHtml)` → `{text, blocks: [{id, start, end}]}`. Parses with **`htmlparser2`**
  (new dep: pure JS, runs in workerd and Node — `HTMLRewriter` isn't available in the Node vitest
  env). Skips `script/style/noscript/template`, decodes entities, collapses whitespace identically
  to the island's normalization. Markdown fields go through `renderMarkdown` first.
- `locate(anchor, canonical)` → exact `prefix+quote+suffix`; else unique `quote`; else occurrence
  nearest the old `start`; else not found. (Fuzzy matching deferred.)
- The island (Part 4) must use the **same normalization**; share the normalizer module between
  `src/lib/anchor/` and `src/client/`.

### 3b. Hook
After a successful save in `updateDocument` / `setPublished` / `restoreRevision`, call
`reanchorComments(db, grant, doc, revision)` — runs under the update grant just obtained; for each
open root text/block anchor, relocate → update `start`, `anchor_revision`, `anchor_status`. Separate
batch, idempotent (a failure leaves stale-but-valid anchors; next save retries). Same code for GUI
and agent edits by construction.

---

## Part 4: Reading-surface review overlay

### 4a. Annotatable region
- Templates/DocumentView wrap body `html`/`markdown` field output in
  `<div data-rm-annotatable data-rm-field="<key>">`. New `wants.annotations` flag
  (`src/templates/types.ts:41`) — set on `article`, `docs`, and the DocumentView fallback.
- Template docs + the D42 packs' author guidance: put `data-rm-anchor="<stable-id>"` on figures and
  widgets so block comments survive revisions (island auto-assigns content-hash IDs otherwise).

### 4b. Island `src/client/review.ts`
- Selection inside a region → popover (intent + body); click on a `[data-rm-anchor]` block →
  block comment; "General comment" button. Captures anchor, sets Datastar signals, `@post`s.
- Highlights painted with the **CSS Custom Highlight API** (`CSS.highlights`) — no DOM mutation, so
  author scripts/charts are never disturbed; outlined blocks via a class on the anchor element.
  Unsupported browser → thread list still works, just no highlights.
- Thread panel is **server-rendered** and patched via Datastar SSE (convention: islands enhance,
  Datastar owns UI state). Clicking a thread scrolls to its highlight; `#comment-<id>` deep links.

### 4c. Routes
- **Reviewers** (`src/routes/s/[token]/…`): `GET` gains the overlay when the grant has `comment`;
  `comments.tsx` (GET panel / POST create), `comments/[id]/replies.tsx`, `identify.tsx` (open-link
  name → `rm_reviewer` HMAC cookie, `path=/s/<token>`, modelled on `src/lib/share-unlock.ts`),
  `done.tsx`. Password unlock (D51) still gates everything first.
  Banner: "Reviewing as Alice" + for `individual` mode the "owner may later share your comments"
  notice.
- **Principals**: `?preview=1&review=1` on `/:collection/:slug` (reuses the D49 session swap) loads
  the overlay; it posts to `src/routes/admin/c/[collection]/[id]/comments/…` (protected prefix,
  session auth), with the internal/shared toggle on each new root.

---

## Part 5: Admin

- **Share panel** (`src/components/admin/share-panel.tsx`, handler
  `src/routes/admin/c/[collection]/[id]/share.tsx`): new "Review links" section — add reviewer
  (name, optional email → personal link + invite), create open link, per-link mode toggle.
  Toggle is two-step: first post returns "This will make 14 comments from 3 reviewers visible to
  everyone reviewing this document" + Confirm (no browser `confirm()`). Reviewer list shows done
  state; revoke per link.
- **Edit page comments panel** in the action rail (`src/components/admin/editor-sidebar.tsx`):
  open/resolved threads with quote, author, intent, anchor status (outdated flagged), reply,
  resolve/reopen, "View in context ↗" → `?preview=1&review=1#comment-<id>`.

---

## Part 6: Agent surfaces

- **`render=review`** — a universal text render available on every `wants.annotations` collection
  (extend `rendersFor`/`renderDocument` in `src/templates/renders.ts`). Output: header (title,
  current revision, reviewers + done status, open/resolved counts), the document's canonical text
  with inline markers `{==quote==}[c7]` / `[block: revenue-chart][c9]`, then threads grouped by
  status (id, author, intent, anchor state, revision, replies). Budget priorities: open `must_fix`
  first, resolved last. Reachable via `get_<slug>` `render` arg and REST `?render=review`.
- **MCP** per-collection, inside a `couldDo('comment')` gate: `comments_<slug>` (list; filters
  status/intent/reviewer/since_revision), `comment_<slug>` (create — agent passes a quote, server
  resolves the anchor), `reply_comment_<slug>`, `resolve_comment_<slug>`, `reopen_comment_<slug>`.
  `update_<slug>` gains `resolves: string[]` — threads resolved at the new revision after a
  successful save.
- **REST**: `GET/POST /api/c/:collection/:id/comments`, `POST …/comments/:cid/replies`,
  `POST …/comments/:cid/resolve|reopen`; OpenAPI entries.
- Events feed (`poll_events`) carries `comment.*` so a session can ask "anything new since seq N?".

---

## Decisions to record (`docs/TECH_DECISIONS.md`)
- **D54** Optimistic concurrency via `expectedRevision` + the revision unique index as atomic backstop.
- **D55** Document review: `comments` + `review_reviewers` fixed tables, the `comment` action,
  review links as `comment`-bearing link grants (first anonymous write), link-mode-derived
  visibility with live flips, shell-mode-only annotation, server-side re-anchoring.

Update CLAUDE.md status block, `steering/ACCESS_CONTROL.md`, `steering/API_AND_MCP_STANDARDS.md`,
`steering/DATABASE_STANDARDS.md` accordingly.

## Out of scope (recorded)
Raw-mode (D27) annotation; suggestion mode (accept/reject proposed text); comment editing;
reply/new-comment email notifications (invite email only); fuzzy re-anchoring; real-time presence /
co-editing; reviewer identity verification beyond link possession; comments on media items.

## Build order
1. Part 1 (concurrency) — ships standalone, own PR.
2. Part 2 (schema, access, service) + Part 3 (canonical text, re-anchor hook).
3. Part 6 agent surfaces (MCP/REST/render) — usable end-to-end via Colin's own principal comments
   created over MCP before any UI exists.
4. Part 4 overlay (principal first, then reviewer links) + Part 5 admin.
5. Docs/decisions, e2e.

## Verification
- `bun run type-check && bun run lint && bun run test:run` each step.
- Unit: concurrency cases (1c); `canonicalText` on fixtures with scripts/charts/entities;
  `locate` across edited revisions (kept, moved, deleted quote → outdated); visibility matrix
  (internal/shared × group/individual × principal/reviewer) incl. mode flip; access: link without
  `comment` is denied, revoked link denied, reviewer can't resolve.
- e2e (`bun run e2e`, + axe on overlay): create personal + open review links; reviewer comments on
  text and on a chart block; group vs individual visibility across two reviewer contexts; flip with
  warning; Colin replies from preview overlay; GUI edit re-anchors; stale admin save shows conflict.
- Agent loop by hand on `bun run dev`: MCP `get_<slug>` `render=review` → `update_<slug>` with
  `expectedRevision` + `resolves` → threads resolved at the new rev; replay with old revision →
  `STALE_REVISION`.
