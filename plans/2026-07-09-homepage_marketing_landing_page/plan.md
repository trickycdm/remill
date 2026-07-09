# remill.org marketing homepage

## Context

remill went live at https://remill.org on 2026-07-09, but `/` still renders the minimal discovery index ("remill / Media / Nothing published yet"). This plan replaces it with a marketing homepage that sells the product. Positioning (per user): remill is a flexible, hosted content system; remill.org is the owner's own instance marketing the product itself, and the page ships in the repo so anyone deploying their own remill gets a product page they can fork and edit. Decisions from planning Q&A: **everything stays at `/`** (discovery index folds in as a lower section), **primary CTA is the agent quickstart** (after the page establishes what remill *is*), and the page is **value-first: customer outcomes, not schema-engine internals**.

**tasteskill v2 is now installed** at `.agents/skills/design-taste-frontend/SKILL.md` (symlinked into `.claude/skills/`). The design below follows its process: design read → dials → design-system map → section design → pre-flight check.

---

## THE DESIGN (tasteskill v2 applied)

**Design read (§0.B):** *Reading this as: an agent-native content-platform landing for technical buyers, inside remill's existing locked "Ink & Paper" brand, with an editorial-precise language, leaning toward the project's own Tailwind v4 token system, serif display type, and restrained CSS-only motion.*

**Mode (§11.A):** brand-exists. The serif masthead, warm-paper palette, and iris accent are the shipped brand (defined in `src/tailwind.css` and `steering/DESIGN_SYSTEM.md`), so tasteskill's serif-discipline and warm-palette bans are overridden per its own §4.1/§4.2/§11.C override clauses. The brand stays; the page must earn "slick, modern, novel" through composition and motion, not new colors.

**Dials (§1):** `DESIGN_VARIANCE: 7` (asymmetric compositions, fractional grids, generous offset whitespace, collapsing to single column < 768px) / `MOTION_INTENSITY: 5` (fluid CSS entrances + scroll reveals + tactile hovers; no scroll-hijack) / `VISUAL_DENSITY: 3` (airy, py-24-ish sections, editorial whitespace).

**Design system map (§2):** no external system; this is the "editorial/magazine" aesthetic family implemented with the project's own tokens. Hard platform constraint that happens to align: public-page CSP is strict self-only (no CDN scripts/fonts/images), so every visual is tokens, hairlines, inline SVG icons, and real rendered components. System font stacks *are* the brand (serif display / sans body / mono metadata).

**Visual language:** warm paper (`bg-canvas` / `bg-surface` full-bleed bands), structure from 1px `border-border` hairlines and whitespace (no heavy cards/shadows), serif display headlines (`font-serif`), mono-caps eyebrows rationed to 2 on the whole page, one accent everywhere (iris: `accent` / `accent-text` / `accent-soft`), one radius scale (`rounded-lg` panels), `rm-anim-rise` entrances plus a new scroll-reveal class gated by `@supports (animation-timeline: view())` (progressive, JS-free, and auto-neutralized by the existing reduced-motion blanket).

**Motion is motivated (§5):** hero entrance = hierarchy (one moment of arrival); scroll-reveals on the ledger rows = storytelling (outcomes land one at a time); `:active` translate on CTAs = feedback. Nothing loops infinitely.

### Section-by-section design (6 sections + chrome; ≥5 distinct layout families; background rhythm canvas → surface → canvas → canvas → surface → canvas)

**Chrome / nav** (single line, ~68px): Wordmark (serif "remill" + iris PenNib glyph) left; right: quiet "Writing" link → `#writing`, "Sign in" → `/admin`. Above it, the brand's one flourish: the `h-0.5 bg-accent/70` hairline across the very top. No CTA button in nav (no duplicate CTA intent, §4.5).

**1. Hero** — family: *centered editorial stack* (manifesto composition is justified here per §4.3 override: the message is the design; the product proof comes one scroll later). `bg-canvas`, `rm-anim-rise`, max 4 text elements:
- Eyebrow №1 (mono-caps): **"Content, milled"** (existing brand colophon, reused verbatim)
- H1, serif, `text-display sm:text-display-lg`, ≤2 lines. Candidate: **"Content that works for humans, apps, and agents."**
- Subtext ≤20 words. Candidate: *"A calm admin for people, a clean JSON API for apps, and safe first-class access for AI agents."* (19 words)
- CTAs: primary `Button lg` **"Connect an agent"** → `#connect`; secondary **"Browse the writing"** → `#writing`
No version labels, no trust strip, no scroll cue, no decoration strip (§9.F).

**2. A calm admin for humans** — family: *asymmetric split* (text 2fr | preview 3fr), full-bleed `bg-surface`. Right side is the sanctioned **real component preview** (§4.8: "an actual mini-version of the UI inside the page"): remill's own `Card`/`Table`/`Badge` primitives rendering a plausible admin list view (real status words: Published / Draft / Scheduled; believable document titles; zero fake numbers). It's genuine semantic markup, so axe passes and it is honestly *not* a fake screenshot: it is the product's real UI code. Copy covers the human outcomes: markdown editing, revisions and diffs, search, trash, scheduled publishing.

**3. Outcomes ledger** — family: *stacked full-width rows with hairline rules* (deliberately not a 3-card grid, §9.C). Four rows, each `border-b border-border`, serif lead + one plain sentence, scroll-reveal stagger:
- A JSON API your apps can trust
- Agents as safe collaborators: their own identities, least-privilege roles, full audit trail (an agent can draft but not publish)
- Publish anywhere: public pages, expiring share links, RSS
- Default-deny security: every write, human or agent, through one validated, authorized pipeline

**4. Six-surfaces proof point** — family: *asymmetric two-column, definition → fan-out*. Left: a compact real collection definition in a mono `pre` panel (`bg-surface border border-border rounded-lg`). Right: h2 **"One definition. Six surfaces."** + 2×3 icon list (inline Lucide-derived icons from `icon.tsx`): storage, validation, admin list, edit form, REST API, MCP tools. Ships **static**; Datastar tab enhancement is a parked follow-up.

**5. Agent quickstart** (`id="connect"`) — family: *numbered steps + code panels*, full-bleed `bg-surface`. Eyebrow №2 (last of the page's two). `<ol>` of three real steps: (1) sign in and mint a bearer token at `/admin/access`; (2) point any MCP client at the endpoint, with a working config block `{"mcpServers":{"remill":{"type":"http","url":"<baseUrl>/mcp","headers":{"Authorization":"Bearer <token>"}}}}` built from `resolveBaseUrl`; (3) raw curl of `tools/list`. Closes with one line on deploying your own remill.

**6. Published writing index** (`id="writing"`) — family: *editorial link index* (the current homepage, demoted): section h2 ("From this mill"), per-collection `<section aria-labelledby>` with **h3** collection names, same link + `formatDate` rows, `EmptyState` when nothing is published.

**Footer**: wordmark, mono colophon, links to `/rss.xml`, `/sitemap.xml`, `/admin`. No version stamp (§9.F).

**Copy rules at write time:** zero em-dashes anywhere visible (§9.G; the README source lines contain them, rewrite), no filler verbs (elevate/seamless/unleash), one register, reuse strong shipped lines, run the §4.9 copy self-audit on every string. Keep the word "Stories" out of marketing copy (Playwright strict-mode collision with an e2e heading locator).

**Pre-flight (§14) items to sweep before PR:** em-dash grep on rendered output; eyebrow count ≤2; hero fits viewport (headline ≤2 lines, CTAs visible); CTA contrast + no label wrap; one accent / one radius scale; heading order h1→h2→h3; both themes checked; reduced-motion verified.

---

## Implementation

Work on a branch (deploys are GitHub-Actions-only; PRs get preview Workers). Commit the installed skill (`.agents/`, `.claude/skills/` symlink) as part of the first commit so it travels with the repo.

### 1. `public/favicon.svg` (new) + `src/layouts.tsx` (one line)
SVG favicon from the PenNib path data (`src/components/ui/icon.tsx` ~line 341), stroke `#4b44a3`, embedded `<style>@media (prefers-color-scheme: dark){...stroke:#b3a9f5}</style>`. Add `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />` to the RootLayout head. `public/` serves at root in all envs (verified via `public/vendor/*`). Safari ignores SVG favicons; acceptable.

### 2. `src/tailwind.css`
New `@theme` type token next to `--text-display`:
```css
--text-display-lg: 3.25rem;
--text-display-lg--line-height: 1.05;
--text-display-lg--letter-spacing: -0.025em;
```
Plus one scroll-reveal utility (`rm-scroll-rise`) inside `@supports (animation-timeline: view())` and `@media (prefers-reduced-motion: no-preference)`; the existing blanket reduced-motion block already neutralizes all animation as belt-and-braces. No new colors/radii/shadows.

### 3. `src/components/layouts/marketing-shell.tsx` (new)
Sibling of `public-shell.tsx` (which stays untouched for doc pages). Same a11y contract: skip link first (copy the class string from `public-shell.tsx:19`), one `<main id="main-content">`, header/footer landmarks. Nav + footer as designed above. Renders children full-bleed; each section manages its own `mx-auto max-w-5xl px-6`. Imports `Wordmark` from `@/components/auth-shell` (not an admin import; do not duplicate the SVG).

### 4. `src/components/marketing.tsx` (new)
Pure Hono JSX section components (`class=`, no hooks; precedent: `auth-shell.tsx`): `MarketingHero`, `CalmAdminSplit`, `OutcomesLedger`, `SixSurfaces`, `AgentQuickstart`, `PublishedIndex`. `PublishedIndex` takes `{ sections, settings }` (the `publicOverview` shape) and reuses the current `index.tsx` list markup + `formatDate`.

### 5. `src/routes/index.tsx` (rewrite, same handler + data shape)
- Data layer identical: `publicOverview(db, nowIso())`, `getSettings(db)`, `resolveBaseUrl`. No new services/queries.
- **Delete `!sections.length → c.redirect('/admin')`**; the page always renders (fresh installs show the product page + empty index; "Sign in" is the operator path). Update the route docblock (it documents the old D35 redirect posture).
- Render `MarketingShell` + the six sections.
- Head props: product-first `title` (e.g. "remill: content, milled"), `description` ≤160 chars (fall back to `settings.siteDescription`), `canonical: `${baseUrl}/``, `ogType: 'website'`, `feedUrl: '/rss.xml'`. **No ogImage** (no raster exists; `PageHead` supports it later).

### 6. Tests
- **New** `src/routes/index.test.tsx` (pattern: `src/routes/api/api.test.ts`): `app.request('/')` on an empty DB → 200 (not 302), contains the h1 copy. Pins the redirect removal.
- **`e2e/public-discovery.spec.ts`**: existing assertions survive (published-doc link, draft absence, axe, 'Stories' heading now h3 — locator is level-agnostic, test-5 navigation click). Add: exactly one `h1`; "Connect an agent" link with `#connect` href; quickstart block contains `/mcp`; `#writing` anchor present; optional dark-mode axe pass via `page.emulateMedia({ colorScheme: 'dark' })`. Verified: no other spec visits `/` or relies on the redirect.

## Verification

```bash
bun run type-check && bun run lint && bun run test:run
bun run e2e        # serial Playwright vs built preview, includes axe
```
Manual with `bun run dev`:
- Both themes (DevTools color-scheme emulation AND `data-theme="dark"` on `<html>`, since admin users carry a persisted theme onto public pages)
- `curl -s http://127.0.0.1:3100/ | grep -E 'og:|canonical|favicon|rss'` → og tags, canonical, RSS alternate, favicon link, no og:image
- `curl -I http://127.0.0.1:3100/favicon.svg` → 200 image/svg+xml
- Keyboard pass (skip link first, anchors land, focus rings on both backgrounds); reduced-motion emulation shows no animation
- tasteskill §14 pre-flight sweep (list above)

Then PR → preview Worker → eyeball the preview URL in both themes → merge → tag `v*` to release (docs/DEPLOYMENT.md).

## Risks / gotchas
- Heading order (h1 → h2 → h3, no skips) is the top axe risk; the index demotion to h3 must land with its section h2.
- Strict public CSP: nothing external, no rasters; visuals = tokens, hairlines, inline SVG, real components only.
- `||` not `??` for settings fallbacks (house pattern). No new route files → no router regen diff.
- e2e runs against the production build; asset-path mistakes surface there, not in dev.

## Out of scope (parked, do not lose)
RESEND_API_KEY + Resend domain verify; confirm bootstrapped admin password changed; LICENSE before repo goes public; SEC-2 rate-limit test deflake; OG image raster + favicon.ico; Datastar tab enhancement for the six-surfaces panel; settings-driven homepage swap for other installs.
