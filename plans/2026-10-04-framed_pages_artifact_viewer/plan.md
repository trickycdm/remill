# Framed Pages for remill: publish an HTML page like a live artifact

## Context

**The problem.** Publishing a one-off HTML page to remill (the headless data platform at https://remill.me, repo `/Users/colin/repos/remill`) is clunky and partly broken:

- Someone has to hand-build a collection, pick "Raw HTML page", and add a field of type `html`. Creating collections needs the `manage_schema` permission, which agents connected by OAuth can never hold.
- A published page has nowhere sensible to be viewed. The admin edit screen shows the HTML as a text box, and the admin view screen injects it into remill's own admin page. The `misc` page `doc_PaH4boUom6UNZCkK2EVu3` looked "broken" for this reason; its stored content is fine.
- Raw pages cannot be commented on in the browser, and agents can only mint read-only links.
- Page scripts run on remill's own origin with no sandbox, so an agent-written page can act as the logged-in admin.

**The outcome.** A clone of the live-artifact model: a thin remill-owned shell (title bar with share, comments, versions, download) wrapped around an arbitrary HTML document in a sandboxed iframe. The same viewer appears from admin, from a share link and from a public URL. Publishing is one call, `publish_page`, with no setup.

**Decisions already made by Col**
1. Shell plus sandboxed iframe. This reverses decision D27's rejection of iframes and D55's exclusion of raw pages from commenting.
2. Luupdin reports and the `misc` page move into the new built-in Pages collection. New ids and dead old share links are accepted.
3. Pages are private by default, with a per-page public opt-in.
4. Agents may mint comment-enabled review links, expiry mandatory and capped at 30 days.
5. Framed pages may load scripts and styles from cdnjs, jsdelivr and unpkg, Google Fonts, and images from any https address. Network calls from the page stay blocked.

## Ground rules for execution

- Branch from `origin/main` (b308b6b or later). Local `main` and the checked-out `feat/editor-page-rework` are stale; that branch is already merged.
- Line references below are to origin/main. Use a clean worktree.
- Stacked PRs, one per phase, each shippable. Retarget the next PR to main before merging its predecessor.
- Next free decision numbers are D60 to D62 and next migration is 0019. Re-check both before starting.
- On approval, move this plan to `/Users/colin/repos/remill/plans/2026-10-04-framed_pages_artifact_viewer/plan.md` with a `worklog.md` beside it.
- Read `CLAUDE.md` and `steering/` first. Every phase runs type-check, lint, `bun run test:run`, and a clean e2e (kill :3100, `rm -rf .wrangler/state/v3/d1`, `bun run e2e`).

## Key design choices

### 1. A third render mode, `frame`
Framing is an engine capability, not a special case for one collection. `renderMode` gains `frame` beside `shell` and `raw`. `raw` stays for public, search-indexable full-page sites.

The column has `CHECK (render_mode IN ('shell','raw'))`. Do **not** rebuild the `collections` table: dropping it cascades and deletes every document, and D1 cannot switch foreign keys off. Widen the constraint with a hand-written column swap instead:

1. `ADD render_mode_v2 text CHECK (render_mode_v2 IN ('shell','raw','frame'))`
2. `UPDATE collections SET render_mode_v2 = render_mode`
3. `DROP COLUMN render_mode`
4. `RENAME COLUMN render_mode_v2 TO render_mode`

This was proven on local SQLite only. Run it against a preview D1 database before tagging a release.

### 2. One content route, authorised by a signed ticket that carries identity
The shell renders `<iframe src="/frame/<ticket>">`. The ticket is an HMAC-signed statement of who is viewing which document and revision. The content route rebuilds that principal and re-runs the normal `authorize()` check, so a revoked link or disabled user fails at once and every read is audited.

- Format: `v1.<docId>.<rev>.<viewer>.<exp>.<sig>`, signed with `SESSION_SECRET`, following `src/lib/share-unlock.ts`.
- Viewer is `a` (anonymous), `p:<principalId>` or `l:<grantId>`. Lifetime 300 seconds.
- No cookie is needed inside the frame, which keeps a later move to a separate hostname cheap.

### 3. Sandbox and frame content policy
The iframe attribute and a `sandbox` directive on the response carry the same tokens, so opening the ticket URL directly is still sandboxed:

`allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads allow-modals`

Never `allow-same-origin`, never `allow-top-navigation`.

Content policy for the framed document, where `O` is the request origin and `CDN` is the three library hosts:

```
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval' O/vendor/ CDN;
style-src 'unsafe-inline' O/vendor/ CDN https://fonts.googleapis.com;
font-src O/fonts/ https://fonts.gstatic.com CDN data:;
img-src https: data: blob: O;
media-src O data: blob:;
connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none';
frame-ancestors 'self';
```

Other headers on the content response: no `X-Frame-Options`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.

Blocking network calls is defence in depth, not a hard boundary: images and popups remain outbound channels for a hostile page. The trusted-author model from D25 still applies.

### 4. Comments through a message bridge
A small bridge script is inlined into the framed document at serve time. It reports text selections to the shell and paints highlights on instruction. The comment panel and its server routes stay unchanged. Everything the frame sends is treated as untrusted: it can only propose an anchor that the person then submits.

### 5. "Private by default, per-page public" needs one new flag
The Pages collection is `access: {publicRead: true, defaultVisibility: 'private'}` with `workflow: {lifecycle: 'none'}`. `defaultVisibility` is new. Without it every new page would be born anonymously readable, because `createDocument` hard-defaults visibility to public (`src/services/documents/index.ts:1082`).

## Phases

### Phase 1: frame engine and minimal viewer (D60, migration 0019)
This phase alone fixes the broken `misc` page.

**Create**
- `src/db/migrations/0019_*.sql`: the column swap.
- `src/lib/frame/policy.ts`: allowlists, sandbox tokens, policy builder.
- `src/lib/frame/ticket.ts`: sign and verify.
- `src/lib/frame/document.ts`: `framePageHtml(def, data)`; `injectFramePreamble` using htmlparser2 positions (insert after `<head>`, else `<html>`, else the doctype, never before it); wrap bare fragments in a minimal document; a small inline script that opens links in a new tab.
- `src/services/frame/index.ts`: `mintFrameTicket`, `readFramedDocument`.
- `src/routes/frame/[ticket].tsx`: the content route.
- `src/components/layouts/viewer-shell.tsx`: full viewport, with title, `VisibilityStamp`, "open full screen" and Edit.

**Change**
- `src/db/queries/documents.ts`: add `getRevision(db, id, revision)`; `listRevisions` loads every revision's full data, which is too heavy for large pages.
- `src/middleware/security-headers.ts`: a `/frame/` branch ahead of `PROTECTED_PREFIXES`.
- `src/main.tsx`: skip session setup for `/frame/`.
- `src/config/constants.ts:25`: reserve `frame`.
- `src/services/collections/index.ts:183-194` and `src/fields/types.ts:72`: accept `frame` (requires an html field).
- `src/components/admin/collection-builder.tsx:128-150`: add a "Framed page" option, and stop dropping `template` and `bind` on save (existing bug).
- Frame branches beside the existing raw early returns: `src/routes/[collection]/[slug]/index.tsx:80`, `src/routes/s/[token]/index.tsx:140`, `src/routes/admin/c/[collection]/[id]/view.tsx`.

**Security.** Invalid or expired tickets return one indistinguishable 404. Old revisions are served only to principals with `update`.

**Docs.** D60 row; `steering/SECURITY_STANDARDS.md` (the "X-Frame-Options DENY on all responses" rule gains the `/frame/` exception); `steering/SCHEMA_ENGINE.md`; `steering/ACCESS_CONTROL.md` (the ticket carries identity, not access); `CLAUDE.md`.

**Tests**
- `src/lib/frame/{ticket,policy,document}.test.ts`: tamper, expiry, wrong-document replay, doctype and head edge cases.
- `src/middleware/security-headers.test.ts`: frame branch has no XFO; every other path still DENY.
- `src/db/seed.test.ts`: the 0019 swap preserves documents and existing `raw` values.
- `src/services/frame/frame.test.ts`: revoked link refused.
- New `e2e/framed-pages.spec.ts`: chart renders from `/vendor`; `fetch` blocked; `document.cookie` and `localStorage` throw; direct ticket URL still sandboxed; no `Set-Cookie`; axe passes and the iframe has a `title`.

**Live check after the tag deploy.** Switch `misc` to `renderMode: 'frame'` over MCP `update_collection`, then open `/admin/c/misc/doc_PaH4boUom6UNZCkK2EVu3/view`.

### Phase 2: full shell (share, versions, download, theme)

- Extract `ThemeToggle` (from `admin-shell.tsx`) and `CopyField` (from `editor-sidebar.tsx`) into `src/components/ui`. Render the existing `ToastHost` in `ViewerShell`.
- Make the share drawer reusable: `src/components/admin/share-drawer.tsx` and `src/routes/admin/c/[collection]/[id]/share.tsx:61-71` take a hidden `surface=viewer` value (closed enum, never a free URL) that picks the companion fragment and fallback redirect.
- `src/components/viewer/versions-drawer.tsx` fed by a new `listRevisionMeta` (no data). "View this version" reloads with `?rev=N`; restore reuses `restoreRevision` (`src/services/documents/index.ts:1568-1588`) switched to `getRevision`.
- `src/routes/admin/c/[collection]/[id]/download.tsx`: the stored HTML as an attachment.
- Each action is gated with `canAuthorize`, as `getShareOverview` does (`src/services/sharing/index.ts:48-90`).

**Tests.** Extend `e2e/visibility-and-share-links.spec.ts` (mint a link from the viewer without leaving it) and `e2e/framed-pages.spec.ts` (view an old version, restore it); a revisions service test.

### Phase 3: comments through the bridge

Start with a 30-minute spike on how the bridge is built. Preferred: a Vite virtual module that bundles `src/client/frame-bridge.ts` to a minified string the content route inlines. Fallback: a committed generated string built by a `Bun.build` script, chained like `bun run routes`. A normal `<Script>` URL will not work, because module scripts from a sandboxed origin are cross-origin requests and static assets send no CORS headers.

- `src/client/frame-bridge.ts`: canonical text map (reusing `src/lib/anchor/text.ts` and `locateQuote`), selection to anchor plus position, Highlight API painting, block outlines.
- `src/client/review.ts`: extract a document adapter with two implementations. `DomAdapter` is today's behaviour. `FrameAdapter` uses postMessage, checks `event.source === iframe.contentWindow`, validates and size-caps messages, and never navigates.
- `src/lib/anchor/canonical.ts:40`: a `document` profile that also skips `<title>`, selected only for a frame collection's page field so existing shell-mode anchors do not move.
- `src/tailwind.css:311-324`: a `.rm-viewer` variant so the panel is a layout column.
- Review branches in the three frame routes. Panel and review routes unchanged.

**Tests.** `anchor.test.ts` (title excluded only in the document profile; shell output byte-identical); adapter message-validation unit test; extend `e2e/document-review.spec.ts` (select text in the frame, comment, highlight survives reload and save; a forged message cannot post; script-generated text downgrades to a whole-document comment).

### Phase 4: built-in Pages collection (D62, migration 0020)

- `ACCESS_SCHEMA` (`src/services/collections/index.ts:45-48`) and `CollectionDefinition`: add `defaultVisibility`, valid only with `publicRead`. `createDocument` honours it.
- `src/db/seed.sql` and `0020_*.sql`: the same `INSERT OR IGNORE` row, `protected = 1`, `render_mode = 'frame'`, fields `title` (text, required, indexed), `html` (html, required), `description` (text), `tags` (tags, indexed). The migration is needed because tag deploys never run the seed (precedent: `0017_shocking_blindfold.sql`).
- Reserve the slug `page` on create only, and add a duplicate-tool-name guard in `src/mcp/tools.ts`, so nothing collides with `publish_page`.
- A document size guard (about 1.8 MB) in the documents service, so an oversized save fails with a clean 413 instead of a D1 error.
- `src/routes/admin/pages/index.tsx` plus a nav entry (`admin-shell.tsx:59-100`): a list that opens the viewer, with a paste-HTML "New page". Follows the `/admin/media` precedent.

**Tests.** `seed.test.ts` (0020 on an existing install; a user's own `pages` row is preserved; seed and migration rows identical; row passes `validateDefinition`); documents test (born private; anonymous list and get denied); new e2e for the public opt-in; check `e2e/html-pages.spec.ts` does not collide with the new "Pages" nav entry.

### Phase 5: agent review links (D61)

- `share_link_<slug>` (`src/mcp/tools.ts:787-832`) and `src/routes/api/c/[collection]/[id]/share-links.tsx:41-64`: an optional `review: {mode}` that calls `createReviewLink` with `maxTtlDays: 30`.
- `createReviewLink` (`src/services/comments/index.ts:661`): additionally require `comment` on the document, so a minter cannot hand out a capability it lacks.
- Docs: `steering/ACCESS_CONTROL.md:44-45, 223-225`, `steering/SECURITY_STANDARDS.md:43-44`, `steering/API_AND_MCP_STANDARDS.md:246`, OpenAPI.

**Tests.** MCP and REST parity; clamp and required expiry; denied without `comment`.

**Operational note.** The live `claude-code` token has no `comment` in its scope. Col widens it in the admin before agents can mint review links.

### Phase 6: `publish_page` and its REST twin

- `src/services/pages/index.ts`: `publishPage` calls `createDocument` or `updateDocument` with `expectedRevision`; title falls back from `<title>` to the first `<h1>` to "Untitled page"; optional share link in the same call; warnings from a new `analyzeFramedHtml` in `src/lib/frame/`.
- Static MCP tool `publish_page {html, title?, description?, tags?, id?, expectedRevision?, share?}` following the `upload_media` precedent (`src/mcp/tools.ts:838`). Returns `{id, url, revision, share?, warnings[]}`.
- `src/routes/api/pages/index.tsx` and `[id].tsx`: `text/html` body, `If-Match`, metadata by query. `MAX_PAGE_BODY_BYTES = 2 MiB`, checked on the real byte length.
- `staticPaths()` in `src/lib/openapi.ts:367` and the steering body-cap table.
- Warnings cover: off-allowlist scripts, styles and fonts; `http:` images; `fetch`, XHR and WebSocket use; `localStorage` and cookies; `<base>`; iframes; large `data:` URIs.
- Pages over the cap are rejected with a message pointing to `upload_media`.

**Tests.** Pages service test; `src/routes/api/api.test.ts` (409 on stale, 413, parity); MCP tool visibility by `create` and `update`.

### Phase 7: live migration (no code)

1. Read each `luupdin-reports` document and the `misc` document; record size and any existing comments.
2. Copy with `publish_page`: `summary` to description; `mode`, `period` and the old slug to tags.
3. Re-mint share links. Agent-minted links are capped at 30 days; Col supplies passwords or mints open-ended links from the viewer.
4. Col checks each page.
5. Export both old collections as NDJSON backups.
6. **Col deletes the two old collections in the admin, after explicit confirmation.** Deleting a collection cascades and bypasses trash.
7. Follow-up outside this repo: update the `founders-report` skill in the luupdin-skills plugin to call `publish_page`.

## Risks and open items

- **Unverified:** `DROP COLUMN` on remote D1 (test on a preview database first); the Vite bridge plugin inside the Cloudflare worker build (spike in phase 3); sizes of the live Luupdin reports.
- **Public framed pages are poor for search engines**, because the content sits in a noindex iframe. `raw` remains the mode for indexable sites.
- **Pages that rely on `localStorage` will throw** in the sandbox. Warned at publish time, not fixed.
- **Revision weight.** The existing admin diff route and `revisions_<slug>` tool still load all revision data; many near-1 MB revisions could strain Worker memory. Only the viewer path is fixed here.
- **D25 rejected "a separate pages subsystem".** D62 must state that Pages rides the schema engine; the only slug-specific code is the `publish_page` convenience and one nav entry.

## End-to-end verification

1. Local: full unit suite, clean e2e, and one screenshot round of the viewer at 1728px and 390px in light and dark.
2. Local MCP: `publish_page` with a chart page, open the returned URL logged in, mint a review link from the viewer, comment on selected text as an anonymous reviewer, save a new version, confirm the highlight survives, view and restore the old version.
3. Preview database: apply 0019 and 0020, confirm document counts are unchanged.
4. Live, after each tag: the phase 1 `misc` check; after phase 6, `publish_page` from this session and confirm an `editor`-role agent can do the same with no schema rights.

## Revision Log
- 2026-10-04: initial plan.
