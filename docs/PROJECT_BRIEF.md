# Project Brief — remill

> Descriptive reference (the *what* and *why*) — the whole-system overview a fresh session should
> read first. For prescriptive rules see `steering/`; for decision history see
> `docs/TECH_DECISIONS.md`; for the active build plan see
> `plans/2026-07-05-platform_knowledge_publishing_roadmap/plan.md`.

## What we are building

A **single-tenant, lightweight, agent-native headless data platform** that runs on one Cloudflare
Worker. It manages any structured data — text, images, video, audio, arbitrary records, and the
**relations between them** — and can **publish and securely share** that knowledge. Content is
exposed four ways:

1. A **styled management interface** (server-rendered, Datastar-driven) — a designed product, not a
   generated admin.
2. A **JSON REST API** for programmatic and headless consumption.
3. An **MCP server**, so AI agents are first-class clients: they can read, write, publish, share,
   and even define new content types.
4. **Rendered public pages**: published documents in public-read collections served as sanitized
   HTML at `/{collection}/{slug}`, relations rendered as navigable links; plus scoped **share
   links** (`/s/:token`) that grant an outsider read access to a single non-public item.

The system began as a v1 CMS (foundation complete and verified). It is being extended — almost
entirely additively — into a general data platform along three tracks: **A. access legibility**
(shipped), **B. relational data & the knowledge graph**, **C. publish & connect**. The secure core
(one `authorize()` decision point, compile-time `Grant` witnesses, append-only audit, hashed scoped
tokens) is preserved untouched.

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
- **Legible access**: every principal, role, grant, and token scope is visible and manageable in the
  product — the access matrix answers "who/what can touch what" at a glance.
- **Connected knowledge** *(Track B)*: records reference records via `relation` fields indexed as
  first-class edges; backlinks make the graph traversable from every surface.
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

Track C adds a **render seam** to the same contract: an optional field `ViewComponent` (default: safe
escaped text) drives read-only detail views and the public HTML pages — the seventh consumer of the
one definition, not a parallel system.

## Access model in two paragraphs

Every actor — human or agent — is a **principal**. Security rides on `kind` (`user` = human session
auth, `agent` = machine bearer token); a display-level **persona** (`subtype`: Person / Service /
Agent) distinguishes humans, data-pulling systems, and AI agents in the UI without weakening the
kind-based rules. Humans are invited through the product (single-use, expiring set-password links;
email delivery is a console-logging stub until a provider is wired). Machine principals get hashed,
scope-masked tokens — scopable per collection × action from the admin.

Authorization is **default-deny, additive-only**: data-defined **roles** (RBAC, scoped assignments, a
tiny closed condition enum — custom roles manageable in the admin) plus per-document **item grants**
with optional expiry, managed from each document's Share panel (admin, REST `/grants`, MCP
`share_<slug>`). One decision point (`authorize()`), enforced by witness types and SQL-compiled list
filters so bypass is a compile error and paginated lists can't leak. The consolidated matrix at
`/admin/access/matrix` shows effective permissions (principal × collection), token scopes, and active
item grants. Everything — every allow and every deny — is audited with principal, token, and surface.

## Current state & direction

- **Foundation (phases 0–7): complete and verified** — the six surfaces, media pipeline, sessions +
  tokens, the access engine, MCP endpoint (decision D18).
- **Track A (access legibility): shipped** — personas, invite-a-person, custom-role CRUD,
  per-collection token scoping, item-grant Share surface, the access matrix, and removal of the dead
  per-collection access map (`publicRead` is the only collection-level access knob).
- **Track B (relational data & the graph): shipped** — `relation` field type + multi-value
  indexing, relation read-expansion on all surfaces, backlinks (admin panel, REST, MCP),
  per-collection lifecycle opt-out (`lifecycle: 'none'` for record-like data that isn't
  draft/published). `repeater`/`object` composites remain deferred.
- **Track C (publish & connect): shipped** — sanitized markdown→HTML rendering via `ViewComponent`,
  public pages at `/{collection}/{slug}` (+ the admin read-only detail view), share links
  (`item_grants` with `subjectKind='link'`, public `/s/:token`).
- **Tier 1 platform completion (Phases 1–4): shipped** — full-text search (FTS5, bm25-ranked, with
  REST `?q=` + operator filters and MCP `search_<slug>` tool), recoverable delete (trash snapshot,
  30-day purge, scheduled Worker jobs), MCP content parity (`upload_media`, `revisions_<slug>`,
  `restore_<slug>`), and audit surfacing (`/admin/activity`, `/api/audit`, MCP `list_audit`). Agents
  over MCP now have full parity with non-technical admins for all content operations; access-management
  mutations remain deliberately human-only.
- **Sharing fabric v2 (shipped before Tier 1)** — teams as a fourth grant subject kind + multi-use
  expiring join links (D24), agent-mintable expiring share links via the `share_link` action (D26),
  Resend email transport realized behind `EmailTransport` (D20), trusted `html` field type +
  per-collection `renderMode: 'raw'` for full pages with per-surface CSP fork (D25/D27).
- **Tier 2 (Phases 5–8): shipped** — scheduled publishing with nullable `publish_at` + per-minute
  cron drain (D30/D32); public discovery pack (D35/D36) — `/rss.xml`, `/sitemap.xml`, `/robots.txt`,
  per-page OG/canonical head props, and `/` homepage; events outbox (D33) — poll-based change feed
  with per-collection read filtering via `GET /api/events` + MCP `poll_events`; import/export as
  NDJSON with upsert-by-id + publish gate, and R2 full-site snapshots (D37).
- **Tier 3 (Phases 9–11): shipped** — editor islands (D38: CodeMirror 6 markdown + native Dialog
  media picker, progressive enhancement over `data-bind` carriers; implements D13, supersedes D12/Uppy),
  revision diff viewer, and bulk list actions via one native form with per-item authorize/audit/events (D39).

Roadmap detail and per-phase status: `plans/2026-07-05-platform_knowledge_publishing_roadmap/plan.md`
(Tracks A–C, worklogs), plus the full completion roadmap
`plans/2026-07-07-platform_completion_tiered_roadmap/plan.md` (11/11 phases complete; Tier 4 & deferred
items recorded in that plan's `Deferred` section).

## Non-goals (current)

Multi-tenancy/multi-site; a theme/template *system* (public pages are one owned layout, not a
pluggable theme engine); a plugin system; field-level access control (hook point reserved);
localization/i18n; push webhooks (events outbox D33 is the deliberate poll-based alternative);
realtime collaboration; video transcoding.

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
8. *(Track B)* Documents reference documents; the graph is traversable — backlinks — from admin, REST,
   and MCP, respecting the reader's permissions.
9. *(Track C)* A published document in a public-read collection renders as sanitized HTML at a public
   URL with relations as working links; drafts and non-public collections 404 anonymously.
10. *(Track C)* A share link grants an outsider scoped read of one non-public item; expiry and
    revocation are honored; "share by email" sends via Resend (or console logs in test/keyless mode).
