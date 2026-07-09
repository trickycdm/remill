# remill

A **single-tenant, lightweight, agent-native headless data platform** (grown from a CMS foundation)
on Cloudflare Workers. It manages any structured data — text, images, video, audio, records, and the
relations between them — and exposes it three ways: a styled Datastar SSR **admin**, a **JSON REST
API**, and an **MCP server** where AI agents are first-class clients. (Roadmap Track C adds a fourth:
rendered public pages + share links.)

> **Before editing — read the relevant standard.** This file is a thin architectural map. Prescriptive
> standards live in [`steering/`](steering); descriptive reference lives in [`docs/`](docs). The
> [Required Reading](#required-reading) table maps each area to its doc. When in doubt, start in
> steering — don't reinvent conventions from the code.

> **Build status.** **DEPLOYED — live at https://remill.org since 2026-07-09** on Cloudflare (all
> deploy access GitHub-Actions-only via `.github/workflows/`; tag-driven `v*` releases, per-PR preview
> Workers with race-aware cleanup). All 8 phases (0–7) of
> [`plans/2026-07-04-cms-foundation/plan.md`](plans/2026-07-04-cms-foundation/plan.md) are **complete and
> verified**, and **Track A of the platform roadmap has shipped** (access legibility: personas, invite
> a person, custom-role CRUD, per-collection token scoping, item-grant Share surface, the access matrix
> at `/admin/access/matrix`). The `src/**` structure below is real, not aspirational. Two logged
> deviations: media uses a dedicated `media` table (not the documents pipeline); MCP is a direct
> streamable-HTTP JSON-RPC endpoint, not an `agents`-SDK DO (decision D18). **Tracks B
> (relations/graph/lifecycle) and C (render/public pages/share links) of
> [`plans/2026-07-05-platform_knowledge_publishing_roadmap/plan.md`](plans/2026-07-05-platform_knowledge_publishing_roadmap/plan.md)
> have also shipped** (B5 composites deferred), followed by **sharing fabric v2**: teams (D24),
> agent-mintable share links (D26), Resend email (D20 realized), and raw HTML pages (D25/D27).
> **The full completion roadmap
> [`plans/2026-07-07-platform_completion_tiered_roadmap/plan.md`](plans/2026-07-07-platform_completion_tiered_roadmap/plan.md)
> (all 11 phases) has shipped**: full-text search + filter operators (D28), cron + recoverable delete
> (D29/D31), MCP parity (D34), audit surfacing, scheduled publishing + the system actor (D30/D32),
> the public discovery pack — rss/sitemap/robots/OG head props + the `/` homepage (D35/D36), the
> events outbox (D33), import/export + R2 snapshot (D37), the editor islands — CodeMirror markdown
> + dialog media picker (D38, implements D13/supersedes D12), the revision diff viewer, bulk
> list actions (D39), and public reading templates (D41). The plan's Deferred/Tier-4 list records what was consciously not built.
> Each steering doc carries its own STATUS header; the worklogs have the step-by-step record.

## The one idea

**One collection definition generates six surfaces: (1) storage, (2) validation, (3) the admin list
view, (4) the admin edit form, (5) the REST API, (6) the MCP tools.** That through-line is the
product; everything else is supporting infrastructure. Field *types* are code (`src/fields/`);
*collections* are data (rows in D1), so an agent can define a content type over MCP and then fill it —
no deploy. This is the constitution: [`steering/SCHEMA_ENGINE.md`](steering/SCHEMA_ENGINE.md).

## Tech Stack

- **Hono 4** + **Hono JSX** (server-rendered HTML, **no React**) + **TypeScript 5.9** (strict); **Bun**
  package manager/runner; **Vite 7** + `@cloudflare/vite-plugin`; deployed via **Wrangler 4**.
- **Datastar v1** — the sole hypermedia runtime, loaded globally in `src/layouts.tsx`. Drives all
  reactive admin UI, form posts, and SSE patches. **No client framework.**
- **Drizzle ORM** + **Cloudflare D1** (SQLite) — for the **fixed** tables only; content is
  schema-as-data, so migrations stay rare.
- **R2** — media originals, streamed with range support.
- **hono-sessions** (encrypted cookie) + **scrypt** (`@noble/hashes`) for human auth; **bearer tokens**
  (hashed at rest, scope-masked) for machine auth (REST + MCP).
- **MCP** — a direct streamable-HTTP JSON-RPC endpoint at `/mcp` (decision **D18**; not the
  `agents`-SDK `McpAgent`-on-a-Durable-Object once planned — that dep was removed).
- **Zod 4** validation (generated from field descriptors); **Vitest 3** + **Playwright** (+ axe);
  **nanoid** IDs; **Tailwind v4** CSS-first `@theme` tokens. **CodeMirror 6** powers the markdown
  editor island and a native Dialog island powers the media picker (`src/client/`, D38 — Uppy/D12
  superseded); islands progressively enhance `data-bind` carriers and load only on the editor
  routes (DATASTAR_PATTERNS §g worked examples).

## Architecture

```
  Browser (admin) ─▶ /admin/**   Datastar SSR management UI
  Any HTTP client ─▶ /api/**     JSON REST (bearer tokens)
  AI agents ───────▶ /mcp        MCP server (streamable-HTTP JSON-RPC, D18)
  Media consumers ─▶ /media/:id  R2 streaming (range requests)
  Public ──────────▶ /:c/:slug   Rendered pages (template or shell or raw HTML, D27/D41) + /s/:token share links (anonymous)
                     / · /rss.xml · /sitemap.xml · /robots.txt   Discovery pack (D35, anonymous gated reads)
  Cron triggers ────▶ scheduled() → src/jobs/ → Services (D29: purges · D32: publish drain as the system actor)

  Routes / DOs → Services (src/services/) → Queries (src/db/queries/) → D1
                        ↑
        Access (src/access/) authorize() gates every service call
```

- **Routes** `src/routes/` — thin, file-based via **hono-router** (file path = URL; handlers export
  `onRequestGet`/`onRequestPost` via `factory.createHandlers(...)`, auth/guard middleware first).
  `bun run routes` regenerates `src/router.ts`; `src/main.tsx` only wires global middleware, `onError`,
  `loadRoutes`, `notFound` — never register routes there by hand.
- **Services** `src/services/` — all business logic **and all authorization** (`authorize()` before any
  read/write; identity-scoped operations like `/admin/account` skip gating). Call queries, never D1.
  Includes search (FTS querying), trash (snapshots + recovery), access (audit, grants), discovery
  (anonymous gated reads for feeds/sitemap/OG, D35), events (outbox + poll feed, D33), transfer
  (NDJSON import/export + R2 snapshots, D37), and scheduled publishing (drainScheduledPublishes
  service, runs per-minute as the system actor, D30/D32).
- **Jobs** `src/jobs/` — cron-triggered maintenance (per `wrangler.jsonc` triggers). Dispatch handler calls
  services only; no D1 access. Per-minute: drainScheduledPublishes (D30/D32). Daily: retention purge
  (D29), events pruning (D33).
- **Queries** `src/db/queries/` — the **only** layer importing Drizzle; row↔domain mapping is private
  here; no Drizzle types leak upward. Includes search (FTS5 querying via `src/db/fts-table.ts`, kept
  outside schema.ts), trash (snapshots + restore), audit reads, and events (outbox rows inserted
  inside mutation batches via eventInsert, D33).
- **Fields** `src/fields/` — the FieldType registry; one module per type, including `relation.tsx`
  (graph edges and backlinks) and `html.tsx` (D25 trusted raw HTML; powers `renderMode: 'raw'`
  pages, D27). The most important interface in the codebase (SCHEMA_ENGINE.md).
- **Templates** `src/templates/` — the render-template registry (the code side of the public
  reading surface); a collection selects a template by name via its `template` key (D41).
  Includes `article.tsx` (the shipped article reading template), `lib/conventions.ts` (pure
  heuristics for hero/dek/body/meta field binding), `blog-pack.ts` (the blog-collection
  scaffold: article template + co-designed collection definition). Templates are code; the
  registry is closed (`keys.ts`).
- **Access** `src/access/` — the single `authorize()` decision point + `Grant` witness types
  (ACCESS_CONTROL.md). Management UI: `src/routes/admin/access/**` (principals grouped by persona,
  invite a person via `users.tsx`, custom roles, token scoping, teams — a grant subject kind, D24 —
  at `/admin/access/teams`, the `matrix/` overview); item-grant sharing via
  `src/components/admin/share-panel.tsx`, the `/api/c/:collection/:id/grants` route, and the MCP
  `share_<slug>` tools; the `share_link` action (D26) lets granted agents mint expiring anonymous
  links over MCP; public invite consumption at `src/routes/auth/set-password/[token].tsx`, team
  join links at `/auth/join/:token`, "Shared with me" at `/admin/shared`. Admin also surfaces activity
  log at `/admin/activity`, search at `/admin/search` (D28), recoverable delete at `/admin/trash` (D29),
  revision diff viewer at `/admin/c/:collection/:id/revisions` (D39), and bulk actions at
  `/admin/c/:collection/bulk` (D39).
- **MCP** `src/mcp/` — the streamable-HTTP JSON-RPC server (`handler.ts` + `tools.ts`); the one
  module owning the MCP protocol surface (decision D18). Tools include `share_<slug>` (subjectKind
  principal|role|team), `share_link_<slug>` (D26 agent-mintable links), `list_teams` (D24), `search_<slug>`
  + `filters` arg (D28), `upload_media` (base64, D34), `revisions_<slug>`, `restore_<slug>`, `delete_<slug>`
  (D34 parity), `schedule_<slug>` (D32 per-collection scheduled publishing), `poll_events` (D33 outbox
  change feed), and `list_audit` (audit log access).
- **`src/lib/`** errors/validation/auth/logging/datastar-response, `persona.ts` (kind+subtype →
  Person/Service/Agent display persona), `email/` (`EmailTransport` — Resend + styled templates,
  D20 realized; console stub fallback), `base-url.ts` (resolveBaseUrl for minted links),
  `lifecycle.ts` (hasLifecycle), `fts.ts` (FTS5 MATCH escaping, snippet render), `base64.ts` (strict
  base64 decode for MCP uploads), `markdown/` (micromark, sanitized), `def-helpers.ts`
  (titleFieldOf/titleOf/publicUrlOf/excerptFrom — shared title/URL/excerpt heuristics, D35),
  `feeds.ts` (pure RSS/sitemap/robots builders, D35), `ndjson.ts` (import/export, D37), `diff.ts`
  (LCS line diff for revision compare view, D39), `reading-time.ts` (word-count estimate, D41);
  **`src/components/`** Hono JSX with `field-view.tsx` (ViewComponent), `document-view.tsx`,
  `layouts/public-shell.tsx` (read-only render), `share-bar.tsx` (reader share UI — copy-link +
  Web Share, D41), `backlinks.tsx` (relation backlinks list); **`src/client/`** browser islands:
  `init.ts` (global loader), `markdown-editor.ts` (CodeMirror 6, D38), `media-picker.ts` (dialog
  picker, D38), `share.ts` (reader share Web Share API, D41).

**Invariant (non-negotiable):** routes and Durable Objects never access D1 directly — all DB
operations go through services → queries. Cron jobs also call services only. All authorization goes through
`authorize()` (except permission-free `getSettings()` reads on the render path, and retention purges in
cron jobs, documented in ACCESS_CONTROL.md). Mirroring `collectionPublicRead`.

## Security posture (why this project exists)

remill reimplements the good idea from **Blogmill** (a 2018 CMS: one field descriptor drives
everything) while structurally eliminating its security holes. Every write path — admin, REST, MCP —
runs through **one whitelist-validated, `authorize()`-gated pipeline**. Undeclared fields are rejected
(anti-mass-assignment). Humans and agents are both **principals**; agents are identities with their own
tokens, roles, and audit trail — never shared keys. Default-deny, additive-only, everything audited.
(One documented trusted exception: the `html` field type renders verbatim markup — D25,
SECURITY_STANDARDS §7.)
See [`steering/SECURITY_STANDARDS.md`](steering/SECURITY_STANDARDS.md) and
[`steering/ACCESS_CONTROL.md`](steering/ACCESS_CONTROL.md).

## Commands

```bash
bun run dev          # regenerate routes + Vite dev (Workers emulation)
bun run build        # regenerate routes + production build
bun run type-check   # tsc --noEmit
bun run lint         # eslint
bun run test:run     # vitest run once
bun run e2e          # Playwright e2e (headless, + axe)
bun run db:generate  # Drizzle migration from fixed-table schema changes
bun run db:migrate   # apply migrations locally
```

**Deployment:** Runbook lives at `docs/DEPLOYMENT.md` (GitHub Actions-based two-phase bootstrap, v* tag releases, preview lifecycle, wrangler env inheritance).

## Required Reading

Map of area → authoritative standard. Start in `steering/` before writing code in that area.

| If you're touching…                                                       | Read first                              |
| ------------------------------------------------------------------------- | --------------------------------------- |
| **The schema engine** — field types, collection defs, the six surfaces    | `steering/SCHEMA_ENGINE.md`             |
| **Authorization** — principals, roles, grants, `authorize()`, audit       | `steering/ACCESS_CONTROL.md`            |
| Any TypeScript file (layering, FP, types, naming, dependency hygiene)     | `steering/CODING_CONVENTIONS.md`        |
| Datastar attributes, @post/@get, dsRedirect, SSE patches                  | `steering/DATASTAR_PATTERNS.md`         |
| Thrown errors, `onError`, Datastar error fragments, deny shape            | `steering/ERROR_HANDLING.md`            |
| Auth, tokens, sessions, secrets, whitelist validation, no-RLS             | `steering/SECURITY_STANDARDS.md`        |
| Migrations, fixed tables, `document_index` EAV, JSON columns, atomic sync | `steering/DATABASE_STANDARDS.md`        |
| REST endpoints, MCP tool generation, token scope masks, OpenAPI           | `steering/API_AND_MCP_STANDARDS.md`     |
| Media: upload, R2, MIME sniffing, range serving, alt-required, deletion   | `steering/MEDIA_STANDARDS.md`           |
| UI tokens, typography, spacing, the component library                     | `steering/DESIGN_SYSTEM.md`             |
| Any new page/component/interaction (WCAG 2.1 AA)                          | `steering/A11Y_STANDARDS.md`            |
| Writing unit tests, verifying a change                                    | `steering/TESTING_AND_VERIFICATION.md`  |
| Playwright e2e, fixtures, auth state, axe sweeps                          | `steering/E2E_TESTING.md`               |
| Deploys — wrangler.jsonc envs, CI workflows, CF resources, secrets        | `docs/DEPLOYMENT.md`                    |
| How this repo is steered (the meta-rules)                                 | `AI_NATIVE_REPO_STANDARDS.md`           |

When a rule here conflicts with existing code, flag it — the doc is usually right; the code may be stale.

## Reference Documentation

Background context in `docs/`, read on demand: `docs/PROJECT_BRIEF.md` (the whole-system overview —
scope, the six surfaces, the Blogmill lineage, current state & direction), `docs/TECH_DECISIONS.md`
(the D1–D41 decision log), and `docs/DEPLOYMENT.md` (Actions-based runbook). The completed foundation plan lives in `plans/2026-07-04-cms-foundation/`;
Tracks A–C roadmap in `plans/2026-07-05-platform_knowledge_publishing_roadmap/`; the tiered completion
roadmap in `plans/2026-07-07-platform_completion_tiered_roadmap/`.
