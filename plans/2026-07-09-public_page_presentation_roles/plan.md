# Public Reading Experience — render templates, not data-model roles

**Status: COMPLETE — 2026-07-09 (all 5 phases shipped & verified; not committed).** Full unit
suite 359 green, type-check 0 err, lint clean, build OK, e2e `public-reading.spec.ts` 2/2 + axe
WCAG2.1AA clean. Migration 0012 (`collections.template`) applied locally. The **live rollout**
(set the deployed `articles` collection `template:'article'`) is a POST-DEPLOY step — the code +
migration must ship first. See worklog.md for the step record. Deferred: admin template picker,
a second template/pack, `beforeRender`-into-public, slot-mapping.

## Context

remill's public article page renders through `DocumentView` (`src/components/document-view.tsx`),
which is *also* the admin inspector and the `/s/:token` share-link page — differentiated only by a
`surface: 'admin' | 'public'` prop that today merely routes href targets. Its `public` branch walks
`def.fields` in definition order and prints **every** populated field as a labelled mono-eyebrow block
(except `markdown`/`html`, which print bare). So a reader sees a `SLUG` row, an `EXCERPT` row, the hero
image wherever its field sits in `fields_json` (often the bottom), and no reading time, no share, no way
home from the masthead (the site name is a plain `<p>`; `settings.logo` is ignored).

The root cause is that `DocumentView` is a generic **record inspector** being used as a **reading
experience**. The fix is not to encode presentation into the schema data (an earlier draft added a
per-field `view.role` hint; rejected — a *layout* is a cohesive artifact and decomposing it into
per-field enum tags smears presentation across the data model). Instead we apply remill's own grain to
the render surface: **field TYPES are code, collections pick them by name; likewise render TEMPLATES are
code, collections pick one by name.** A **template registry** (`src/templates/`) holds tasteful,
purpose-built reading layouts; a collection selects one via a `template` key. `renderMode: 'raw'`
remains the bring-your-own-HTML escape hatch. The full spectrum:

- **`shell`** (default) — the generic `DocumentView` renderer; any collection, zero taste.
- **`template: 'article'`** — a purpose-built reading layout from the registry (ships with a handful).
- **`raw`** — a full standalone HTML document (existing, D27).

"Blog-ness" never enters the engine or the core render path. It lives in an opt-in **blog pack**: the
`article` template (code) plus a co-designed collection scaffold (data). This directly answers the
original worry about overfitting the CMS to a blog. The one trade vs the rejected roles approach: an
agent can *pick* a shipped template (no deploy) or write `raw` HTML (no deploy), but inventing a *new
reusable template* needs a developer + deploy — accepted ("designed for developers").

Intended outcome: a genuinely designed reading experience (hero → title → dek → body → meta → share),
driven by convention so pack-shipped collections need zero presentation config, plus three cross-cutting
fixes (home link + logo, reading time, reader share) and two bugs (media `alt=""`, title-heuristic
divergence).

## Design intent (taste)

Redesign-**preserve**: evolve, don't overhaul. Keep the brand — warm-paper canvas, iris/indigo accent
(`#4b44a3`), serif display, `.rm-prose` body at 65ch (`src/tailwind.css`). Editorial/blog dials
(~VARIANCE 5 / MOTION 3 / DENSITY 3): calm hierarchy, generous rhythm, one H1, real hero with real alt,
quiet meta line. No AI tells (no eyebrow on every block, no version stamps, no scroll cues, no
em-dashes). Stack is Hono JSX + Datastar SSR (no React/Motion); the win is *hierarchy*, not animation.

## Decisions already made

1. **Render templates (code), not per-field roles (data).** Templates are a registry selected by a
   `template` key on the collection — parallel to how collections pick field types by name.
2. **Convention-first binding.** Templates read fields by type/convention (first media = hero, first
   non-title text = dek, markdown/html = body, tags/relation = meta, slug omitted) and degrade
   gracefully when a field is absent. The blog pack ships a collection co-designed to match, so
   convention always resolves. (No slot-mapping now; add later only if a shipped template must attach to
   a non-conforming collection.)
3. **Thin-slice pack.** Ship the registry + one `article` template + reading-context + reader-share +
   shell fixes + bug fixes. The "blog pack" is initially the `article` template plus a documented
   collection scaffold; defer the formal pack-install/module machinery until a second pack exists.
4. **Reading time lives at the template/context layer, not a field hook.** Reading time is a
   document-level derived value; a per-field `beforeRender` is the wrong altitude. A small
   render-context builder computes it once and hands it to the template (extensible: TOC, word count,
   "updated X ago" later). Wiring `beforeRender` into the public read path is a separate, deferred
   capability.
5. **Reader share ≠ access-control share.** Copy-URL + Web Share, not the admin grant `share-panel.tsx`.
   Suppressed on `/s/:token` (already a private link).
6. **Templates render inside `PublicShell`** (not full-page), so masthead/footer/skip-link/landmarks and
   the new home-link/logo come free to every template. Only `raw` bypasses the shell.
7. **`DocumentView` stays the generic inspector**, essentially untouched (only the title-heuristic
   unification, a correctness fix). Templates are resolved in the route *before* the `DocumentView`
   fallback — smallest possible blast radius.

## How to execute (fresh-session bootstrap)

- **Read first:** root `CLAUDE.md`, then `steering/SCHEMA_ENGINE.md` (the `template` selector + the
  template contract sit beside the field registry), `steering/DATABASE_STANDARDS.md` (the additive
  migration), `steering/DATASTAR_PATTERNS.md` §g (the share island), `steering/A11Y_STANDARDS.md`,
  `steering/DESIGN_SYSTEM.md`, `steering/E2E_TESTING.md`. Steering is authoritative.
- **Commands:** `bun run type-check` / `bun run lint` / `bun run test:run` / `bun run e2e` (clean run
  migrates+seeds — never bare `bunx playwright test`) / `bun run db:generate` (drizzle-kit) /
  `bun run db:migrate` / `bun run build`. No new route files → no `bun run routes` needed.
- **Layering invariant:** routes/components/templates never touch D1 — services → queries only. Reading
  time and convention field-picking are *pure* (`src/lib/`, `src/templates/lib/`); DB reads (media
  expansion) live in services/queries. A template `Component` receives already-loaded `def`/`doc`/`ctx`
  and does no I/O.

## Phase map

| Phase | What | Depends on | Independently shippable |
|---|---|---|---|
| 0 | Shell + correctness: masthead home-link+logo, title-heuristic unify, reading-time helper | — | yes |
| 1 | Media `alt` read-path expansion (bug) | — | yes |
| 2 | Template infra + the `article` template (the visible win) | 0 + 1 | yes |
| 3 | Reader share (component + island) wired into the template | 2 | yes |
| 4 | Blog pack thin slice: collection scaffold + docs + live rollout | 2 | — |

Phases 0 and 1 are parallelizable; 2 needs both; 3 and 4 follow 2.

---

## Phase 0 — Shell + correctness (template-independent)

**0a — Masthead home-link + logo** (`src/components/layouts/public-shell.tsx`). Wrap the brand in
`<a href="/" aria-label={`${siteName} — home`}>` with a visible focus ring. Inside: `settings.logo` set
→ `<img src={`/media/${settings.logo}`} alt="" class="h-8 w-auto" />` (decorative; the link carries the
name); else the serif brand mark. Generalize `Wordmark` (`src/components/auth-shell.tsx`) with an
optional `label?: string` (default `'remill'`), keeping the serif + iris PenNib treatment while showing
the site's own name; `AuthShell` keeps calling `<Wordmark />`. Optionally relocate `Wordmark` to
`src/components/ui/wordmark.tsx` and re-export, so `public-shell` doesn't import the auth shell.
PublicShell already receives `settings`.

**0b — Title-heuristic unification.** Delete `displayTitleField` (`document-view.tsx:15`,
`admin?.showInList ?? fields[0]`) and source the title field from `titleFieldOf(def)`
(`src/lib/def-helpers.ts`) in `DocumentView`, so the on-page H1 equals the OG/feed/canonical title
everywhere. Keep the local empty→`def.name` H1 fallback. Verified no admin H1 change for seeded
`settings`/`posts`. Templates (Phase 2) use `titleFieldOf` too. Unit test: H1 field key === `titleFieldOf(def)`.

**0c — Reading-time helper** (`src/lib/reading-time.ts`, new pure).
`readingTimeMinutes(text, wpm = 220): number` → `Math.max(1, round(words / wpm))`, `0` for empty. Unused
until Phase 2; land + unit-test it here.

**Verify:** unit tests; eyeball the public page (home link + logo); axe unaffected.

## Phase 1 — Media `alt` read-path expansion (bug)

`media.tsx` ViewComponent/CellComponent hardcode `alt=""` (`src/fields/media.tsx:73`, :72); they get
only the media id, and `alt` lives in the dedicated `media` table (`src/db/queries/media.ts`), which the
documents read path never touches. Fix by mirroring B2 relation expansion (batched, no N+1):

1. `src/db/queries/media.ts` — `getMediaByIds(db, ids): Promise<Map<string, MediaRecord>>` (one
   `inArray(media.id, ids)` batch).
2. `src/fields/types.ts` — `MediaMeta = { id; alt: string|null; width: number|null; height: number|null }`;
   add optional `readonly media?: MediaMeta` to `FieldViewProps`.
3. `src/services/documents/index.ts` — `expandMedia(db, principal, def, rows, now)`: collect
   `field.type === 'media'` values across rows, batch-load, attach a `media` sibling on
   `ExpandedDocument` keyed by field key (like `relations`). Gate once with
   `authorize('read', { collection: 'media' })`; on `ForbiddenError` **degrade to no expansion — never
   throw** (`media` is `publicRead`, so anonymous passes; a public page must not 500 over metadata).
   Call beside `expandRelations` in `getDocument` and `listDocuments` (which `getDocumentBySlug` reuses)
   so both public routes get it.
4. `src/components/field-view.tsx` — thread `media` to the media ViewComponent; consumers resolve
   `doc.media?.[field.key]`.
5. `src/fields/media.tsx` — ViewComponent uses `media?.alt ?? ''` and `media?.width`/`height` (also
   fixes CLS). The `article` template's hero reads the same `MediaMeta`.

`ogImage` (first media id → `/media/{id}`) unchanged. Admin list-cell alt threading is a Phase-4 follow-up.

**Verify:** documents-service unit test (expansion + Forbidden degrade); extend
`src/components/field-view.test.tsx` (media alt); `getMediaByIds` query test.

## Phase 2 — Template infrastructure + the `article` template

**Persistence (one additive migration).** Render config lives in columns here (`render_mode` is a
CHECK-constrained column, migration 0006). Add a **new nullable `template` column** (no DB CHECK —
template keys grow in code; validated in the service). `render_mode` is untouched.
- `src/db/schema.ts` — add `template: text('template')` to the `collections` table (line ~118, beside
  `renderMode`). Run `bun run db:generate` → migration `0012_*.sql` (`ALTER TABLE collections ADD template text`),
  then `bun run db:migrate`.
- `src/db/queries/collections.ts` — map it: row→domain (`template: (row.template as string) ?? undefined`,
  ~line 29) and domain→row on insert/update (`template: def.template ?? null`, ~lines 61, 87).
- `src/fields/types.ts` — `readonly template?: string;` on `CollectionDefinition` (a single render
  *selector*, like `renderMode` — not per-field presentation).

**Template registry** (`src/templates/`, new — parallels `src/fields/`):
- `src/templates/types.ts`:
  ```ts
  export interface TemplateContext {
    readonly readingMinutes: number;
    readonly shareUrl?: string;   // omitted on /s/:token (private link)
    readonly siteName: string;
    readonly baseUrl: string;
  }
  export interface RenderTemplate {
    readonly key: string;     // 'article' | 'minimal' | …
    readonly name: string;    // human label (admin picker, deferred)
    readonly Component: FC<{ def: CollectionDefinition; doc: ExpandedDocument;
                             backlinks: Backlink[]; ctx: TemplateContext }>;
  }
  ```
- `src/templates/registry.ts` — `resolveTemplate(key?: string): RenderTemplate | undefined` and
  `templateKeys(): string[]`.
- `src/templates/lib/conventions.ts` (pure, type-only dep — no registry import): `heroField(def)`,
  `dekField(def, titleField)`, `bodyFields(def)`, `metaFields(def)`. Encapsulate the heuristics (first
  media = hero, first non-title/non-slug text = dek, markdown/html = body, tags/relation/select/datetime
  = meta, slug omitted). This is convention *inside the template layer*, not a role concept in the engine.
- `src/templates/article.tsx` — the reading layout. Renders, top-to-bottom, inside PublicShell's main:
  hero `<figure>` (real alt + intrinsic dims, from Phase 1) → `<header>` with one serif `<h1>`
  (`titleFieldOf`) + quiet meta line (`<time datetime>` · `N min read` · a few tags) → `<p class="rm-standfirst">`
  dek → body via the existing `FieldView` seam (markdown → `.rm-prose`) → quiet meta `<section aria-label="Details">`
  (tags/relations via their ViewComponents) → share slot (Phase 3) → shared `Backlinks`. Extract the
  existing "Referenced by" block from `document-view.tsx` into a shared `Backlinks({ backlinks, surface })`
  consumed by both. New `.rm-standfirst` token in `src/tailwind.css` (larger, muted; match `.rm-prose`).

**Validation** (`src/services/collections/index.ts`, beside the `renderMode` check at ~line 147): if
`input.template` is set, it must be in `templateKeys()` — else push an issue (mirrors field-type
validation against the registry). Closed set, rejected on write.

**Route resolution** (`src/routes/[collection]/[slug]/index.tsx`): after the existing `rawPageHtml`
short-circuit and `getBacklinks`, build `ctx` and pick the renderer:
```tsx
const body = buildSearchText(def, doc.data)?.body ?? '';
const tpl = resolveTemplate(def.template);
const ctx = { readingMinutes: readingTimeMinutes(body), shareUrl: publicUrlOf(def, doc, baseUrl),
              siteName, baseUrl };
const content = tpl
  ? <tpl.Component def={def} doc={doc} backlinks={backlinks} ctx={ctx} />
  : <DocumentView def={def} doc={doc} backlinks={backlinks} surface="public" />;
return c.render(<PublicShell settings={settings}>{content}</PublicShell>, head);
```
`renderMode:'raw'` still wins (short-circuits first). Apply the same resolution in
`src/routes/s/[token]/index.tsx` (shared item deserves the same layout) but pass `ctx` **without**
`shareUrl` (suppress public share on a private link) — factor a tiny `renderPublicDocument(...)` helper
if the duplication is more than a few lines.

**Verify:** `src/templates/lib/conventions.test.ts` (each picker; empty/absent fields; slug omitted);
collections-validation test (valid template round-trips; unknown template rejected); render the
`article` template to a string in a component test (hero alt present, no slug row, dek as standfirst,
`N min read`). E2E in Phase 3/verification.

## Phase 3 — Reader share (component + island)

Server-render (works with no JS) a `<section aria-label="Share">` in the `article` template: the
canonical URL as a real `<a href={ctx.shareUrl}>` plus static social anchors built from `shareUrl`
(`twitter.com/intent/tweet?...`, `mailto:?...`) — plain navigations, CSP-clean. Two buttons hidden
server-side (`class="hidden"`, media-picker precedent): `data-share-copy` and `data-share-native`. New
island `src/client/share.ts` unhides them, wires `navigator.clipboard.writeText(url)` and
feature-detected `navigator.share({ title, url })` (hide native when absent), and writes "Copied" into an
`aria-live="polite"` span. Load it from the route file (`vite-ssr-components` only discovers `<Script>`
in `src/routes/**`): add `<Script src="/src/client/share.ts" />` to
`src/routes/[collection]/[slug]/index.tsx`. Render the share section only when `ctx.shareUrl` is present
(so `/s/:token` omits it). Clipboard/`navigator.share` are browser APIs Datastar can't express —
sanctioned island territory (DATASTAR_PATTERNS §g).

**Verify:** e2e (below) + axe.

## Phase 4 — Blog pack (thin slice) + docs + rollout

- **Collection scaffold** co-designed for the `article` template: export a `blogCollectionScaffold`
  `CollectionDefinition` (title text, indexed slug `{from:'title'}`, hero `media`, `excerpt` text (dek),
  `body` markdown, `tags`, `template:'article'`, `workflow.draftPublish`, `access.publicRead`). "Install"
  = create it via MCP `create_collection` / REST / a small script; document the payload. No installer UI.
- **Docs:** `steering/SCHEMA_ENGINE.md` (the template registry + `template` selector, beside field
  types), `steering/DESIGN_SYSTEM.md` (`.rm-standfirst`, the article reading view), a new decision in
  `docs/TECH_DECISIONS.md` (next D-number: render templates + the blog-pack direction). Do docs
  alongside Phases 2–3.
- **Live rollout:** after deploy, set the live `articles` collection's `template` to `'article'` via MCP
  `update_collection` (its fields already match convention) — the reading redesign goes live with no
  content migration.
- **Deferred:** pack-install/module machinery; a second template (`minimal`/`docs`); admin
  collection-editor template picker + per-field controls; per-document template override; slot-mapping;
  `beforeRender` wired into the public read path; admin list-cell media-alt threading.

---

## Verification (end-to-end)

**Unit (Vitest — pure/service, cheap):** reading-time; `conventions` pickers (all cases, slug omitted);
collections validation (template key valid/invalid; `renderMode` still enforced); `expandMedia` (attaches
alt; degrades on Forbidden); `getMediaByIds`; H1 === `titleFieldOf`; `article` template render (hero alt,
no slug row, dek as standfirst, reading time). Extend `src/components/field-view.test.tsx` for media alt.

**E2E (Playwright, `steering/E2E_TESTING.md`).** Extend `scripts/seed-e2e.ts` `posts` to match the
article template (`media` hero, `excerpt` dek, `tags`) with `template:'article'`, and seed a **published**
post (posts are `draftPublish` — publish it) with a hero media id + non-empty alt. New
`e2e/public/reading.spec.ts` (`anonymousPage`, `test.use({ storageState: { cookies: [], origins: [] } })`,
distinct `CF-Connecting-IP`): hero `<img>` at top with the seeded alt; **no** `Slug` row; excerpt as
standfirst not an `Excerpt` row; `N min read` + `<time>` visible; masthead home link
(`getByRole('link', { name: /home/i })`) → `/`; Copy-link button visible after JS, canonical `<a>` present
without JS. Add the reading URL to the axe sweep (`e2e/a11y/pages.spec.ts`) → zero violations. Gotchas:
`fillMarkdown` (never `getByLabel` for the CodeMirror body), `{ exact: true }` on ambiguous names, serial
single worker, clean `bun run e2e` only.

**Manual + live:** `bun run build` + preview; visit a templated article (hero top, no slug/excerpt rows,
reading time + date, home link + logo, copy/native share); visit `/s/:token` (renders, share suppressed);
visit a non-templated publicRead collection (generic shell still works). Then over the remill MCP: set the
live `articles` collection `template:'article'`, publish an article with a hero, and confirm the live page.

## Risks / pitfalls

- **Blast radius stays tiny.** `DocumentView` (admin + shell-mode public) is untouched except the title
  unify; templates resolve *before* it in the route. Admin inspector unchanged.
- **Convention mismatch.** A template on a non-conforming collection degrades (no hero if no media, no dek
  if no text) rather than breaking; the blog pack ships a matching collection so it always resolves. Slot-
  mapping is the escape hatch if needed later.
- **Additive migration only.** `template` is a new nullable column; `render_mode`'s CHECK is not touched;
  `renderMode:'raw'` precedence preserved. Confirm the drizzle-generated 0012 is a pure `ADD COLUMN`.
- **Shared across both public routes.** `/s/:token` renders templates too (good) but omits `shareUrl`
  (share suppressed). Make `ctx.shareUrl` optional and guard the share section on it.
- **Media expansion must degrade, never throw** on `ForbiddenError`.
- **Don't regress OG/discovery.** `titleOf`/`publicUrlOf`/`excerptFrom`/`ogImage` (feeds/sitemap/homepage/
  OG) are unchanged; the title unify *reduces* divergence. OG description stays `excerptFrom(body)`; the
  visible dek uses the `excerpt` field (absent → no standfirst; OG description still works).
- **a11y:** one `<h1>`; hero real alt (Phase 1); logo decorative under a labelled link; share buttons carry
  `aria-label`s + an `aria-live` "Copied" region; `<time datetime>`; reading time is plain text (never
  color-only). Skip-link/landmarks stay in `PublicShell`.
- **CSP/islands:** `share.ts` loads only via route `<Script>`, makes no external calls, social links are
  plain anchors — CSP-clean, no `allowCdnScripts` interaction.

## Critical files

- `src/templates/` — **new**: `types.ts` (`RenderTemplate`/`TemplateContext`), `registry.ts`
  (`resolveTemplate`/`templateKeys`), `lib/conventions.ts` (pure pickers), `article.tsx` (the layout).
- `src/routes/[collection]/[slug]/index.tsx` — resolve template, build `ctx` (reading time + shareUrl),
  load `share.ts`; `src/routes/s/[token]/index.tsx` — same resolution, share suppressed.
- `src/fields/types.ts` — `CollectionDefinition.template?: string`; `MediaMeta`; `FieldViewProps.media`.
- `src/db/schema.ts` + migration 0012 + `src/db/queries/collections.ts` — the `template` column.
- `src/services/collections/index.ts` — validate `template` against `templateKeys()`.
- `src/services/documents/index.ts` — `expandMedia` beside `expandRelations`; `src/db/queries/media.ts` —
  `getMediaByIds`; `src/fields/media.tsx` — use expanded alt/dims.
- `src/components/document-view.tsx` — title unify; extract shared `Backlinks`.
- `src/lib/reading-time.ts` — **new**; `src/client/share.ts` — **new**; `src/tailwind.css` —
  `.rm-standfirst`; `src/components/layouts/public-shell.tsx` + `auth-shell.tsx` — masthead link/logo,
  `Wordmark` `label?`.

## Revision Log
- 2026-07-09: Plan created from a taste-skill audit.
- 2026-07-09: **RE-PLAN** — abandoned the per-field `view.role` approach (presentation in the data model)
  for a **render-template registry** selected by a `template` key, after the user's stress-test: a layout
  is a cohesive code artifact, not scattered field tags. Convention-first binding; thin-slice "blog pack"
  (article template + collection scaffold); reading time at the template/context layer, not a field hook.
  Cost delta: one additive `template` column migration (roles needed none), for a far smaller blast radius
  and clean separation of presentation from schema.
