# Project Brief — remill

> Descriptive reference (the *what* and *why*), distilled from the build plan §1. For prescriptive
> rules see `steering/`; for the full plan see `plans/2026-07-04-cms-foundation/plan.md`.

## What we are building

A **single-tenant, lightweight, agent-native CMS** that runs on one Cloudflare Worker. It manages any
type of content — text, images, video, audio, and arbitrary structured records — and exposes that
content three ways:

1. A **styled management interface** (server-rendered, Datastar-driven) — a designed product, not a
   generated admin.
2. A **JSON REST API** for programmatic and headless consumption.
3. An **MCP server**, so AI agents are first-class clients: they can read, write, publish, and even
   define new content types.

The public-facing website is **out of scope for v1**. The CMS is headless-first; a rendering/theme
layer can be added later as just another API consumer.

## Why it exists — the Blogmill lineage

The author previously built **Blogmill** (~2018), a small Node/Express/MySQL CMS. Its implementation is
dead — process globals, jQuery/Grunt/TinyMCE, raw SQL string-building, and real security holes (mass
assignment of the whole request body, unescaped SQL identifiers, a shared weak signing secret). None of
that code survives.

But its **central idea predates the tools that later popularized it** (Payload, Directus): a
declarative schema where **one field descriptor drives everything**. In Blogmill, a single JS object
per content type generated the SQL DDL, the admin list view, the admin edit form, and the
validation/save pipeline. The whole admin ran on two generic routes; adding a content type meant adding
one file. The engine was ~350 lines.

remill reimplements that idea on a modern substrate and **extends it from four generated surfaces to
six**:

> **One collection definition generates: (1) storage, (2) validation, (3) the admin list view,
> (4) the admin edit form, (5) the REST API, (6) the MCP tools.**

Because collections are *data* (not code), an MCP client can define a new content type and then
populate it, entirely over the wire. That is what makes remill *agent-native* rather than
agent-bolted-on.

## Design goals

- **Lightweight**: one Worker, one D1 database, one R2 bucket. Deployable with `wrangler deploy`. No
  build farm, no separate admin SPA, no external services required to run.
- **Agent-native**: MCP is a core surface with parity to the admin. Content is stored agent-friendly
  (Markdown, structured JSON), not opaque HTML blobs. Autonomous agents are first-class principals with
  their own identities, least-privilege roles, and audit trails — not users of a shared API key.
- **Schema-driven everywhere**: if a feature can't be generated from the collection definition, question
  whether it belongs.
- **Designed, not generated-looking**: the admin has a real visual identity, design tokens, and an owned
  component library.

## The six surfaces, briefly

| # | Surface | Generated from |
|---|---|---|
| 1 | Storage (`documents` + `document_index`) | field `toIndex` |
| 2 | Validation (one Zod validator, all doors) | field `valueSchema` |
| 3 | Admin list view (columns, cells) | field `CellComponent` + `showInList` |
| 4 | Admin edit form (widgets) | field `EditComponent` |
| 5 | REST API + OpenAPI | field `jsonSchema` |
| 6 | MCP tools | field `jsonSchema` + collection labels |

## Access model in one paragraph

Every actor — human or agent — is a **principal**. Humans authenticate with sessions, agents with
bearer tokens; both resolve to a principal before any authorization decision. Authorization is
**default-deny, additive-only**: data-defined **roles** (RBAC, scoped assignments, a tiny closed
condition enum) plus per-document **item grants**. One decision point (`authorize()`), enforced by
witness types and SQL-compiled list filters so bypass is a compile error and paginated lists can't leak.
Everything — every allow and every deny — is audited with principal, token, and surface.

## Non-goals (v1)

Multi-tenancy/multi-site; public site rendering/themes; a plugin system; field-level access control
(hook point reserved); localization/i18n; webhooks; realtime collaboration; video transcoding.

## Success criteria

1. `wrangler deploy` + seed → a working, styled CMS on a workers.dev URL in under ten minutes.
2. A non-technical user can create a collection, upload media, author markdown, and publish — entirely
   in the admin UI.
3. An AI agent over MCP can do everything that user just did, including defining the collection — when
   granted the roles.
4. A developer can build a public site against the REST API using only `/api/openapi.json`.
5. Every write path runs through one whitelist-validated, `authorize()`-gated pipeline; the Blogmill
   vulnerabilities are structurally impossible, not just avoided.
6. A least-privilege agent can draft but not publish; every action and denial is attributed in the
   audit log to that agent's principal, token, and surface.
7. A fresh agent session, reading only steering, produces convention-conformant code on the first try.
