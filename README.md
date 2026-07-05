# remill

A **single-tenant, lightweight, agent-native CMS** on Cloudflare Workers. One collection definition
generates six surfaces — storage, validation, the admin list view, the admin edit form, the REST API,
and the MCP tools — so humans and AI agents author the same content through the same
whitelist-validated, authorization-gated pipeline.

- **Admin**: Datastar server-rendered management UI (no client framework).
- **REST API**: content-negotiated JSON + generated OpenAPI.
- **MCP**: agents are first-class clients — they can read, write, publish, and define content types.

Runs on one Worker, one D1 database, one R2 bucket. Deployable with `wrangler deploy`.

## Status

Under active construction, phase by phase. **Phase 0 (steering) lands first, before application code.**
See the build plan and worklog:

- Plan: [`plans/2026-07-04-cms-foundation/plan.md`](plans/2026-07-04-cms-foundation/plan.md)
- Worklog: [`plans/2026-07-04-cms-foundation/worklog.md`](plans/2026-07-04-cms-foundation/worklog.md)

## For contributors (human or agent)

Start with [`CLAUDE.md`](CLAUDE.md) — the architectural map and the Required Reading table. Prescriptive
standards live in [`steering/`](steering); background reference in [`docs/`](docs). Don't reinvent
conventions from the code — read the relevant standard first.

The one idea, and how to extend it, is in [`steering/SCHEMA_ENGINE.md`](steering/SCHEMA_ENGINE.md).

## Lineage

remill reimplements the good idea from **Blogmill** (a 2018 Node/Express/MySQL CMS — one field
descriptor drives everything) on a modern substrate, while structurally eliminating Blogmill's security
holes. See [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md).

## Local development

Wired in Phase 1. Once scaffolded:

```bash
bun install
bun run dev          # Vite dev with Workers emulation
bun run test:run     # unit tests
bun run e2e          # Playwright + axe
```

To enable the pre-commit hook (type-check + lint):

```bash
git config core.hooksPath .githooks
```
