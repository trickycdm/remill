# remill

A **single-tenant, lightweight, agent-native CMS** on Cloudflare Workers. It manages any content type
— text, images, video, audio, structured records — and exposes it three ways: a styled Datastar SSR
**admin**, a **JSON REST API**, and an **MCP server** where AI agents are first-class clients.

> **Before editing — read the relevant standard.** This file is a thin architectural map. Prescriptive
> standards live in [`steering/`](steering); descriptive reference lives in [`docs/`](docs). The
> [Required Reading](#required-reading) table maps each area to its doc. When in doubt, start in
> steering — don't reinvent conventions from the code.

> **Build status.** All 8 phases (0–7) of
> [`plans/2026-07-04-cms-foundation/plan.md`](plans/2026-07-04-cms-foundation/plan.md) are **complete and
> verified** (0 type errors, 0 lint, 66 unit + 16 e2e green, build OK). The `src/**` structure below is
> real, not aspirational. Two logged deviations: media uses a dedicated `media` table (not the documents
> pipeline); MCP is a direct streamable-HTTP JSON-RPC endpoint, not an `agents`-SDK DO (decision D18).
> Each steering doc carries its own STATUS header; the worklog has the step-by-step record.

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
  **nanoid** IDs; **Tailwind v4** CSS-first `@theme` tokens. _Deferred / not yet wired:_ the
  **CodeMirror 6** markdown island and **Uppy** uploads — `src/client/init.ts` is an empty stub and
  the markdown/tags/media widgets are plain inputs in v1.

## Architecture (TARGET layout)

```
  Browser (admin) ─▶ /admin/**   Datastar SSR management UI
  Any HTTP client ─▶ /api/**     JSON REST (bearer tokens)
  AI agents ───────▶ /mcp        MCP server (streamable-HTTP JSON-RPC, D18)
  Media consumers ─▶ /media/:id  R2 streaming (range requests)

  Routes / DOs → Services (src/services/) → Queries (src/db/queries/) → D1
                        ↑
        Access (src/access/) authorize() gates every service call
```

- **Routes** `src/routes/` — thin, file-based via **hono-router** (file path = URL; handlers export
  `onRequestGet`/`onRequestPost` via `factory.createHandlers(...)`, auth/guard middleware first).
  `bun run routes` regenerates `src/router.ts`; `src/main.tsx` only wires global middleware, `onError`,
  `loadRoutes`, `notFound` — never register routes there by hand.
- **Services** `src/services/` — all business logic **and all authorization** (`authorize()` before any
  read/write). Call queries, never D1.
- **Queries** `src/db/queries/` — the **only** layer importing Drizzle; row↔domain mapping is private
  here; no Drizzle types leak upward.
- **Fields** `src/fields/` — the FieldType registry; one module per type. The most important interface
  in the codebase (SCHEMA_ENGINE.md).
- **Access** `src/access/` — the single `authorize()` decision point + `Grant` witness types
  (ACCESS_CONTROL.md).
- **MCP** `src/mcp/` — the streamable-HTTP JSON-RPC server (`handler.ts` + `tools.ts`); the one
  module owning the MCP protocol surface (decision D18).
- **`src/lib/`** errors/validation/auth/logging/datastar-response; **`src/components/`** Hono JSX;
  **`src/client/`** browser islands (CodeMirror, Uppy).

**Invariant (non-negotiable):** routes and Durable Objects never access D1 directly — all DB
operations go through services → queries. All authorization goes through `authorize()`.

## Security posture (why this project exists)

remill reimplements the good idea from **Blogmill** (a 2018 CMS: one field descriptor drives
everything) while structurally eliminating its security holes. Every write path — admin, REST, MCP —
runs through **one whitelist-validated, `authorize()`-gated pipeline**. Undeclared fields are rejected
(anti-mass-assignment). Humans and agents are both **principals**; agents are identities with their own
tokens, roles, and audit trail — never shared keys. Default-deny, additive-only, everything audited.
See [`steering/SECURITY_STANDARDS.md`](steering/SECURITY_STANDARDS.md) and
[`steering/ACCESS_CONTROL.md`](steering/ACCESS_CONTROL.md).

## Commands (TARGET — wired in Phase 1)

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
| How this repo is steered (the meta-rules)                                 | `AI_NATIVE_REPO_STANDARDS.md`           |

When a rule here conflicts with existing code, flag it — the doc is usually right; the code may be stale.

## Reference Documentation

Background context in `docs/`, read on demand: `docs/PROJECT_BRIEF.md` (scope, the six surfaces, the
Blogmill lineage) and `docs/TECH_DECISIONS.md` (the D1–D17 decision log). The full build plan and its
worklog live in `plans/2026-07-04-cms-foundation/`.
