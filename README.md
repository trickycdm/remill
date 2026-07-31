# remill

A **single-tenant, lightweight, agent-native headless data platform** on Cloudflare Workers. One
collection definition generates six surfaces — storage, validation, the admin list view, the admin
edit form, the REST API, and the MCP tools — so humans and AI agents author the same content through
the same whitelist-validated, authorization-gated pipeline.

**Live at [https://remill.me](https://remill.me)**

## The one idea

**One collection definition generates six surfaces: storage, validation, admin list view, edit form,
REST API, and MCP tools.** Field types are code; collections are data (rows in D1), so an agent can
define a content type over MCP and then fill it — no deploy required. See
[`steering/SCHEMA_ENGINE.md`](steering/SCHEMA_ENGINE.md).

## Surfaces

- **Admin**: Datastar server-rendered management UI at `/admin/**` — no client framework.
- **REST API**: Content-negotiated JSON at `/api/**` — bearer tokens, full CRUD.
- **MCP**: AI agents are first-class clients at `/mcp` — read, write, publish, share, define types.
- **Public pages**: Rendered at `/:collection/:slug` — raw HTML or styled shell.
- **Share links**: Anonymous access at `/s/:token` — agent-mintable or invite-based.
- **Discovery**: `/`, `/rss.xml`, `/sitemap.xml`, `/robots.txt` — anonymous gated reads.

## Status

**Complete and live** (2026-07-09). All planned roadmaps shipped:
- CMS foundation (8 phases)
- Platform Tracks A–C (access, relations, publishing, sharing fabric v2)
- 11-phase completion roadmap (full-text search, scheduled publishing, events, import/export, trash/recovery, revision diffs, bulk actions, audit, etc.)

See [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md) for the big picture and
[`docs/TECH_DECISIONS.md`](docs/TECH_DECISIONS.md) for the D1–D39 decision log. Plan worklog
artifacts live in `plans/`.

## Stack

**Backend:** Hono 4 + Hono JSX (server-rendered, no React), TypeScript 5.9 strict, Bun, Vite 7 +
`@cloudflare/vite-plugin`, Wrangler 4.

**Data:** Drizzle ORM + Cloudflare D1 (SQLite), R2 media, KV rate limiting.

**Admin UI:** Datastar v1 (sole hypermedia runtime), Tailwind v4, CodeMirror 6 (markdown editor),
native dialog (media picker).

**Agents:** MCP streamable-HTTP JSON-RPC endpoint. Bearer tokens (hashed at rest), scope masks,
audit trail.

**Testing:** Vitest 3 + Playwright (+ axe accessibility).

## Security posture

Every write path — admin, REST, MCP — runs through **one whitelist-validated, `authorize()`-gated
pipeline.** Undeclared fields are rejected (anti-mass-assignment). Humans and agents are both
**principals** with their own tokens, roles, and audit trail. Default-deny, additive-only, fully
audited. One documented exception: the `html` field type renders raw markup (D25).

See [`steering/SECURITY_STANDARDS.md`](steering/SECURITY_STANDARDS.md) and
[`steering/ACCESS_CONTROL.md`](steering/ACCESS_CONTROL.md).

## Quick start (local development)

```bash
bun install
bun run dev                      # Vite dev with Workers emulation (http://127.0.0.1:3100)
bun run db:seed                  # Seed system data + local dev admin
bun run test:run                 # Unit tests
bun run e2e                      # Playwright + axe accessibility
```

Enable the pre-commit hook (type-check + lint):

```bash
git config core.hooksPath .githooks
```

**Local overrides:** `.dev.vars` holds `BASE_URL`, `SESSION_SECRET`, and optional `RESEND_API_KEY`.
Default admin: `admin@remill.local` / `remilladmin` (local only).

## For contributors

**Architecture & design:** Start with [`CLAUDE.md`](CLAUDE.md) — the architectural map and the
Required Reading table that points to `steering/` standards by area. Prescriptive rules live in
[`steering/`](steering); background reference in [`docs/`](docs).

**Common tasks:**
- Adding a field type → `steering/SCHEMA_ENGINE.md` + `src/fields/`
- Changing auth or grants → `steering/ACCESS_CONTROL.md` + `src/access/`
- New routes or handlers → `steering/DATASTAR_PATTERNS.md` + `src/routes/`
- Database schema changes → `steering/DATABASE_STANDARDS.md` + `src/db/schema.ts`

## Deployment

**Single-tenant on Cloudflare Workers.** GitHub Actions only: two-phase idempotent bootstrap for a
fresh account, tag-driven releases (push `v*` → migrate + deploy + rotate secrets), per-PR preview
Workers with isolated D1. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full runbook.

## Lineage

remill reimplements the good idea from **Blogmill** (a 2018 Node/Express/MySQL CMS — one field
descriptor drives everything) on a modern substrate, while structurally eliminating Blogmill's
security holes. See [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md).

---

**Commands:** `bun run dev | build | type-check | lint | test:run | e2e | db:generate | db:migrate`
