# Inline pages: render `html` documents in remill's own page, no iframe (D63)

## Context

Pages published to the built-in `pages` collection (D62) render in a sandboxed iframe (`renderMode: 'frame'`, D60). The iframe brings ticketed `/frame/:ticket` URLs, a postMessage bridge for comments, a nested scroll area and its own CSP. D60 assumed page authors might be hostile. remill is single-tenant and only Col publishes, so we're going back to D25's trust model ("collection write permission = trusted author"). Pages will render **inline** in remill's page and their scripts will run. Comments will use the same-page review path that shell-mode documents already use. The model is html.surf's reader view, minus its script ban.

Agreed with Col:
- Scripts run automatically, including on agent-published pages. There is no per-page "trusted" gate.
- Rendering happens in a new mode alongside the others. `pages` switches to it, and frame mode stays until the inline pages are signed off. Removing frame mode is a separate follow-up PR.
- All 8 existing pages must render as they do today. Measured: all are full documents, 5 have inline scripts, 3 use Google Fonts, and all style `*`/`body`. None load CDN scripts, external images, fetch or storage.

Pre-step: local `main` is 15 commits behind. Fast-forward it with `git pull --ff-only`; the tree is clean. Branch `feat/inline-pages`.

## Design

### 1. The inline transform: `src/lib/inline/` (new, pure, htmlparser2)

`prepareInlineDocument(html): { title, head, body, wrapperAttrs }`. It follows the slicing pattern in `src/lib/frame/document.ts` (`insertionPoint` uses parser `startIndex`/`endIndex`).

- **Head:** keep `<style>`, `<link rel=stylesheet|preconnect|preload>` and `<script>`, in their original order. Drop `<title>` (it becomes the page title), `<meta>` and `<base>`.
- **Body:** the inner HTML of `<body>`, or the whole input if it's a bare fragment.
- **Wrapper attributes:** carry `class`/`style`/`lang`/`dir` from `<html>`/`<body>` onto the wrapper, merging classes, so `body.dark`-style selectors keep matching.
- **Output:** `<div class="rm-page" data-ignore data-rm-field="html" data-rm-annotatable>{head}{body}</div>`. Head scripts come before the body content, which matches original document order. `data-ignore` makes Datastar skip the subtree, including nodes added later (the vendored v1.0.2 `It()` uses `closest('[data-ignore]')`).

`scopeCss(css): string`. A small brace-depth tokenizer that handles strings and comments; no CSS parser dependency.
- Hoist `@import`, `@charset`, `@font-face`, `@keyframes`, `@property` and `@namespace` outside the scope block, because they can't nest in `@scope`.
- Wrap everything else in `@scope (.rm-page) { … }`.
- Inside it, rewrite selector tokens `html`, `body`, `:root` (and compounds like `html body`) to `:scope`, recursing into `@media`/`@supports`/`@container`/`@layer`.
- Apply this to every inline `<style>`. External stylesheets other than font CSS can't be scoped; the analyzer warns about them.

**Restoring browser defaults.** Tailwind's preflight is global and would strip UA defaults from author content (heading sizes, list bullets, margins). Emit one unlayered `@scope (.rm-page) { :where(:scope, :scope *) { all: revert } }` before the author's styles. Its specificity is zero, so any author rule wins, and being unlayered it beats Tailwind's `@layer base`.

### 2. Render mode `'inline'`

- **Type and validation:** `src/fields/types.ts:84` becomes `'shell' | 'raw' | 'frame' | 'inline'`, with a doc comment. `validateDefinition` (`src/services/collections/index.ts:196-207`) accepts it and requires an `html` field. `src/db/schema.ts:130` comment.
- **Migration `0021_inline_render_mode.sql`:** the same column swap as 0019 (add `render_mode_v2` with `'inline'` in the CHECK, copy, drop, rename), then `UPDATE collections SET render_mode='inline' WHERE slug='pages' AND render_mode='frame'`. Update `meta/_journal.json`.
- **Seed:** in `src/db/seed.sql:104-116` the `pages` row becomes `'inline'` and the "sandboxed frame" help text is reworded. In `src/db/seed.test.ts`, change the parity test to compare the seed with the effect of 0020 plus 0021, and add a case that 0021 admits `'inline'`.
- **Gate helper:** `inlinePageHtml(def, data)` next to `framePageHtml` (`src/lib/frame/document.ts:26`), reusing `pageFieldOf`, with the same null-means-fall-back contract. Move `pageFieldOf` into `src/lib/inline/` (or a neutral `src/lib/page-document.ts`) so it survives the later frame-mode deletion.
- **Anchoring:** `canonicalDocument` (`src/lib/anchor/canonical.ts:99`) applies the `'document'` profile when the mode is `'frame'` **or `'inline'`**. Server and client then agree, because `<title>` is stripped from inline output and skipped server-side.
- **Admin:** add an "Inline page" option to the collection builder (`collection-builder.tsx:176-178`, `554-570`), with a description. List rows link to `/view` for `'inline'` too (`generated.tsx:192`).

### 3. Shell: ViewerShell gets a flow layout

`src/components/layouts/viewer-shell.tsx` takes either `frameSrc` (today's behaviour) or `content` (the inline output).
- In content mode it drops the `h-dvh` layout with its own inner scroll area. The bar is sticky and the document scrolls naturally. This is required: The Context Cache reads `document.documentElement.scrollTop`.
- The review panel uses the existing shell-mode docking (`body.rm-reviewing` padding plus a fixed `.rm-review-panel`, `src/tailwind.css:311-323`).
- `review.ts:262-266` already picks `domDocument` and adds `rm-reviewing` when there is no iframe, so the client needs no change.
- Add `.rm-page` to the review CSS so `body.rm-reviewing`'s right padding still applies. The author's `body` rule now targets `.rm-page`, not `body`, so it can't undo the padding.
- `<title>`: the route passes `prepareInlineDocument().title ?? doc title` to the layout.

### 4. Routes: one inline branch per surface, beside the existing frame branch

Use the same order in each: `raw` → `inline` → `frame` → template/shell.
- **Public** `src/routes/[collection]/[slug]/index.tsx:84-144`: ViewerShell with `content`. Keep the frame branch's preview, Edit and visibility behaviour and `no-store`. Unlike frame mode, enable `?review=1` here as well (the shell-mode review code at 171-189 already exists).
- **Share link** `src/routes/s/[token]/index.tsx:150-168`: as frame mode, with `reviewerPanel` on review links.
- **Admin viewer** `src/routes/admin/c/[collection]/[id]/view.tsx:48-161`: same actions (Share, Comments, Versions, Download, Edit, `?rev=N` with Restore). A past revision renders inline from the revision data. Rewrite the comment at 44-47 that says html is "never inlined into the admin DOM".
- No change needed: `hasReviewSurface` (`services/sharing/index.ts:62`) is `!== 'raw'`, so inline already qualifies for review links. `download.tsx` has no mode check.

### 5. CSP: a page policy chosen by the route

- Move the allowlist constants (`FRAME_CDN_HOSTS`, `FRAME_FONT_STYLE_HOST`, `FRAME_FONT_FILE_HOST` from `src/lib/frame/policy.ts:18-25`) and `frameAllows`'s logic into `src/lib/page-policy.ts`, renamed `PAGE_*` / `pageAllows`. `frame/policy.ts` imports them.
- `src/middleware/security-headers.ts`: add `pagePolicy`, which is `policy()` plus:
  - `script-src` CDN hosts
  - `style-src` CDNs and `fonts.googleapis.com`
  - `font-src` `fonts.gstatic.com`, CDNs, `data:`
  - `img-src https: data: blob:`
  - `media-src 'self' data: blob:`
  `connect-src`, `frame-ancestors 'none'` and `X-Frame-Options` stay as they are. An inline-rendering route calls `c.set('pageCsp', true)`, and the dispatcher, after `await next()`, overwrites the CSP header with `pagePolicy` when that flag is set (the same after-next pattern as the `frame` middleware at `:73-79`). Other public and admin routes are unchanged.
- This gives inline pages the same resource access frame pages have today. Add the `pageCsp` variable to the Hono `Env` type.

### 6. Publishing path

- `src/services/pages/index.ts:55-58`: `getPagesCollection` accepts `'inline'` (or `'frame'` until removal). Line 84: warnings come from an analyzer driven by `pageAllows`. Generalise `analyzeFramedHtml` (`src/lib/frame/analyze.ts`) to take the allowlist and move it to `src/lib/inline/analyze.ts`. Add one new warning: an external stylesheet that won't be scoped.
- `src/mcp/tools.ts:332-345`: register `publish_page` for `'inline'` and rewrite its description (no sandbox; scripts run; CDNs, Google Fonts and https images are allowed). Add `'inline'` to the `create_collection` mode list (`:217-219`).

### 7. Docs

- `docs/TECH_DECISIONS.md` **D63**: "Inline pages; trusted single author; partially reverses D60's sandbox rationale for `pages`". Explain why (one trusted author, plus the costs of the iframe: nested scroll, Cmd-F, print, bridge complexity) and what was rejected (Shadow DOM: selection and highlight wrinkles across browsers; a per-page trust flag: Col declined; html.surf's script ban: charts need scripts).
- `CLAUDE.md` status line and the `steering/SCHEMA_ENGINE.md` / `SECURITY_STANDARDS.md` render-mode sections: add the trusted-author note, and state that agent-published pages run scripts as the viewer.

## Tests

- **Unit:**
  - `src/lib/inline/*.test.ts`:
    - head/body extraction, title, and wrapper attribute merging
    - hoisting `@font-face`/`@keyframes`/`@import`
    - `body`/`html`/`:root` → `:scope`, including inside `@media`
    - strings and comments containing braces
    - fragments with no `<html>`
  - Fixtures: two of the real pages (Context Cache and one Luupdin report), exported via MCP `get_pages`.
- **Updates:**
  - `viewer.test.ts`: inline renders content, not an iframe, plus review gating.
  - `pages-collection.test.ts:33`
  - `pages.test.ts:166,206,230-290`
  - `collections.test.ts:82`
  - `anchor.test.ts:68,80`
  - `security-headers.test.ts`: the page policy only on routes that set the flag, and `/admin/login` stays strict
  - `seed.test.ts`
- **E2E** `e2e/inline-pages.spec.ts`, modelled on `html-pages.spec.ts` and `framed-review.spec.ts`:
  - publish a page with a script, a Google Font `<link>`, `body{}`/`*{}` CSS and a `data-on:click` attribute
  - assert:
    - the script ran
    - Datastar did not evaluate the attribute
    - the remill bar's computed margin and font are unaffected
    - the CSP header contains `fonts.gstatic.com`
    - select text → comment → the highlight is painted → reload → it re-anchors
  - Update the `framed-pages.spec.ts:238,264` cases that assume `pages` is frame mode.

## Verification

1. `bun run type-check && bun run lint && bun run test:run && bun run e2e`, all green.
2. **Real pages, before and after:**
   - Pull all 8 pages with MCP `get_pages`.
   - Load them into local dev (`bun run dev`) through `POST /api/pages`, while `pages` is still frame mode.
   - Take Playwright full-page screenshots of each `/admin/c/pages/:id/view`.
   - Apply 0021 locally and screenshot again.
   - Compare the pairs by eye, and check that The Context Cache's progress bar and dots and the Luupdin chart tooltips still work.
   - Expected and acceptable: The Context Cache's fixed progress bar overlaps remill's sticky bar.
3. Open the PR. Merge and release once green (standing permission), then spot-check the 8 pages and one comment on remill.me.
4. **Follow-up PR, after sign-off:** delete frame mode. That covers:
   - `/frame` route, `services/frame`, `lib/frame/{ticket,messages,document,policy}`, `client/frame-bridge.ts`
   - `review.ts` `frameDocument`
   - the frame branch in each route, the frame CSP branch
   - the frame e2e specs
   - a migration to drop `'frame'` from the CHECK
