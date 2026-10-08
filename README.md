<p align="center">
  <a href="https://remill.me">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/brand/remill-wordmark-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="docs/brand/remill-wordmark-light.svg">
      <img alt="remill" src="docs/brand/remill-wordmark-light.svg" width="300">
    </picture>
  </a>
</p>

<p align="center">
  <strong>A print shop for the agent age.</strong><br>
  One schema, six surfaces, and AI agents that sign in like everyone else.
</p>

<p align="center">
  <a href="https://remill.me"><img alt="Live at remill.me" src="https://img.shields.io/badge/live-remill.me-0078bf?style=flat-square&labelColor=23364a"></a>
  <img alt="Runs on Cloudflare Workers" src="https://img.shields.io/badge/runs_on-Cloudflare_Workers-5348b8?style=flat-square&labelColor=23364a">
  <img alt="Speaks MCP" src="https://img.shields.io/badge/speaks-MCP-ef2c9b?style=flat-square&labelColor=23364a">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-f2ecdd?style=flat-square&labelColor=23364a"></a>
</p>

---

remill is a **single-tenant, lightweight, agent-native headless data platform** on Cloudflare
Workers. It holds any structured data — writing, images, records and the relations between them — and
serves it to people through a server-rendered admin, to programs through a JSON REST API, to AI agents
through an MCP server, and to readers as rendered public pages.

Humans and agents are both **principals**: each has its own identity, credentials, role and audit
trail, and every write from every surface passes through the same validated, authorised pipeline.

**[Visit remill.me →](https://remill.me)**

## Why it exists

remill is the second life of **Blogmill**, a small CMS written in 2018. Blogmill had one good idea —
a single field descriptor per content type drove the database, the admin list, the edit form and the
save pipeline — and several bad habits: it assigned whole request bodies to the database, built SQL
from strings, and shared one weak signing secret.

remill keeps the idea and removes the habits by construction:

- **Whitelist validation.** Undeclared fields are rejected, so mass assignment cannot happen.
- **One gate.** Every read and write goes through a single `authorize()` decision point. Access is
  default-deny and additive only.
- **Real identities for agents.** No shared keys; agent tokens are hashed at rest, scope-masked and
  audited like any other principal.

The one documented exception is the `html` field type, which renders trusted markup verbatim (see
[`steering/SECURITY_STANDARDS.md`](steering/SECURITY_STANDARDS.md)).

## One definition, six surfaces

A collection definition is a row of data, not code. Write one and remill derives everything else:

| # | Surface | Where it shows up |
|---|---|---|
| 1 | **Storage** | D1 tables and an indexed field store, no migration needed |
| 2 | **Validation** | Zod schemas generated from the field descriptors |
| 3 | **Admin list** | `/admin/c/:collection` with bulk actions, import and export |
| 4 | **Admin edit form** | Server-rendered with Datastar; one scroll, with a draft preview |
| 5 | **REST API** | `/api/c/:collection` with bearer tokens, described at `/api/openapi.json` |
| 6 | **MCP tools** | `create_`, `get_`, `list_`, `search_`, `update_`, `share_` and more, per collection |

Because collections are data, an agent can define a new content type over MCP and start filling it
in the same session, with no deploy. The full contract is in
[`steering/SCHEMA_ENGINE.md`](steering/SCHEMA_ENGINE.md).

```
  Browser ─────▶ /admin/**    Datastar SSR admin
  HTTP client ─▶ /api/**      JSON REST
  AI agent ────▶ /mcp         MCP server (OAuth 2.1)
  Reader ──────▶ /:c/:slug    Rendered pages, feeds, share links
                    │
                    ▼
       Routes → Services → Queries → D1 / R2
                    ▲
          authorize() gates every call
```

## What you can do with it

**Publish.** Install a content pack from the Marketplace — blog, changelog, portfolio, docs, prompts
or collab — and get a collection and a matching reading template in one step. Pages ship with RSS, a
sitemap, rich SEO and social metadata, reading time and a share colophon. Schedule a publish for
later; preview a draft on the real reading page before it goes out.

**Publish a page in one call.** Hand remill a standalone HTML page — from the admin, `POST /api/pages`
or the MCP `publish_page` tool — and it appears in the built-in `pages` collection, rendered inline
in the viewer with its scripts intact. Pages are private until you opt one in.

**Share and review.** Every document is public, unlisted or private. Share it with a person, a role
or a team, or mint an expiring link — optionally password-locked, optionally allowed to comment.
Reviewers leave threads anchored to the exact text or figure; agents can read, reply to and resolve
those threads too. Saves use optimistic concurrency, so nobody silently overwrites anyone else.

**Connect an agent.** remill is its own OAuth 2.1 authorisation server for `/mcp`, so Claude Code, Cursor, VS Code
or any MCP client connects by URL alone, with device pairing for clients that cannot open a browser.
The connect wizard at `/admin/access/connect` produces a ready-to-paste config per client. Prompt
collections show up as native MCP prompts in the client's picker, and documents can be returned as
role- and budget-tailored markdown.

**Find and recover.** Full-text search with filter operators across admin, REST and MCP. Revision
history with a diff viewer, a recoverable trash, an activity log, and an events feed agents can poll.

**Move data.** NDJSON import and export, plus snapshots to R2.

**Explore.** Nebulae, the admin dashboard's 3D graph, draws every collection as a cluster and every
relation as a flight path between them.

**Sign in properly.** Passwords or passkeys for people; invitations, custom roles, teams and an
access matrix that shows who can do what.

## Quickstart

You need [Bun](https://bun.sh) and a recent Node.js (Wrangler runs on it). No Cloudflare account is needed
for local development; Wrangler emulates D1, R2 and KV.

```bash
bun install
cp .dev.vars.tpl .dev.vars      # then set SESSION_SECRET (openssl rand -hex 32)
                                # and add BASE_URL=http://127.0.0.1:3100
bun run db:migrate              # apply migrations to the local D1
bun run db:seed                 # seed system data and create the local admin
bun run dev                     # http://127.0.0.1:3100/admin
```

Sign in as `admin@remill.local` with the password `remilladmin`. Those credentials exist only in your
local database; production admins are created with `bun run db:bootstrap:remote` and a password you
choose (see [`.dev.vars.tpl`](.dev.vars.tpl)).

Turn on the pre-commit hook (type-check and lint) with `git config core.hooksPath .githooks`.

| Command | What it does |
|---|---|
| `bun run dev` | Migrate, regenerate routes, start Vite with Workers emulation |
| `bun run build` | Regenerate routes and build for production |
| `bun run type-check` | `tsc --noEmit` |
| `bun run lint` | ESLint |
| `bun run test:run` | Vitest, once |
| `bun run e2e` | Playwright end-to-end tests with axe accessibility checks |
| `bun run db:generate` | Generate a Drizzle migration from fixed-table schema changes |

## Under the hood

- **Hono 4** with server-rendered Hono JSX — no React, no client framework.
- **Datastar** drives every interactive admin surface over server-sent events; small islands
  (CodeMirror 6, the media and relation pickers, the graph) load only where they are needed.
- **Cloudflare D1** through Drizzle for the fixed tables; content is schema-as-data. **R2** for media,
  streamed with range support.
- **MCP** as a direct streamable-HTTP JSON-RPC endpoint, with remill as its own OAuth server.
- **Tailwind v4** tokens for the *Overprint* identity: two risograph inks on cream or navy stock,
  Bricolage Grotesque for display type, and AA contrast in both themes.
- **Vitest** and **Playwright** with axe for verification.

The layering is strict: routes call services, services call queries, and only queries touch the
database. Authorisation lives in services, behind one function.

## Finding your way around

[`CLAUDE.md`](CLAUDE.md) is the architectural map and the place to start. Prescriptive standards live
in [`steering/`](steering); background in [`docs/`](docs).

| If you are… | Read |
|---|---|
| Getting the big picture | [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md) |
| Wondering why something is the way it is | [`docs/TECH_DECISIONS.md`](docs/TECH_DECISIONS.md) |
| Adding a field type or changing collections | [`steering/SCHEMA_ENGINE.md`](steering/SCHEMA_ENGINE.md) |
| Touching roles, grants or `authorize()` | [`steering/ACCESS_CONTROL.md`](steering/ACCESS_CONTROL.md) |
| Working on REST or MCP | [`steering/API_AND_MCP_STANDARDS.md`](steering/API_AND_MCP_STANDARDS.md) |
| Building admin UI | [`steering/DATASTAR_PATTERNS.md`](steering/DATASTAR_PATTERNS.md) and [`steering/DESIGN_SYSTEM.md`](steering/DESIGN_SYSTEM.md) |
| Writing tests | [`steering/TESTING_AND_VERIFICATION.md`](steering/TESTING_AND_VERIFICATION.md) |

## Deploying

remill is single-tenant: one deployment, one Cloudflare account. All deploy access runs through
GitHub Actions — a two-phase, idempotent bootstrap for a fresh account, `v*` tags for production
releases, and a preview Worker with its own D1 for every pull request. The runbook is
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Licence

[MIT](LICENSE). The Bricolage Grotesque typeface is used under the
[SIL Open Font License](public/fonts/LICENSE-OFL.txt).
