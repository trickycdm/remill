# remill backlog

Standing feature backlog. Committed items get a dated plan folder when work starts;
ideas stay here until promoted. Brainstormed 2026-07-17.

## Committed — next up

### 1. Prompt library pack (D42 machinery + MCP `prompts` primitive)

- New content pack in `src/templates/packs.ts`: a `prompts` collection — title, slug,
  body, variables, tags, model hints, usage notes, example output — plus a co-designed
  `prompt` template (copy button, highlighted `{{variables}}`).
- Free rides: revisions (D39) = prompt versioning; search (D28); share links (D26).
- **The novel bit:** serve items from the prompts collection as native MCP prompts —
  `prompts/list` / `prompts/get` in the JSON-RPC handler (D18 makes this ours to own),
  collection `variables` field → MCP prompt arguments. Any MCP client then sees the
  library in its prompt picker, interpolation included.
- Stretch (not this pass): fetch a prompt pinned to a revision (`prompt@rev`) over API.
- **Evals pack deliberately excluded for now** (see Ideas).

### 2. Graph explorer (`/admin/graph`)

- Visual explorer over Track B relations/backlinks. Must look exceptional and sit
  squarely in the Overprint identity (D43).
- **Direction chosen 2026-07-17 via proof-sheet artifact: "Nebulae"** — 3D canvas
  universe in the gig-poster dark register; each collection a tilted galactic disk
  with its own haze, cross-collection relations as lifted arcing flight paths;
  pop pink reserved for the hover/selection event; drag-to-orbit, depth fog,
  starfield. Plain-canvas island, zero deps (D38 pattern). Round-1 flat proofs and
  round-2 3D proofs preserved in the artifact's version history.

## Ideas — not committed

- **Webhook delivery for the events outbox** — push completion of D33: signed HMAC
  POSTs, retry/backoff, dead-letter into a collection. Unlocks agent-reacts-to-change
  without polling.
- **Agent enrichment loops as a first-class pattern** — conventions (a `pending-review`
  lifecycle state, "enriched by" audit trail) so external agents subscribe to events
  and auto-tag / excerpt / suggest relations. Keeps remill model-free.
- **Eval-set pack** — `eval-cases` collection (input, expected output, tags) related to
  prompts. Chains off the prompt pack; deferred with it.
- **Digest email** — weekly "what changed" to the owner. Resend (D20) + cron (D29/D32)
  already exist; mostly a query + template.
- **Public inbound writes (forms)** — gated anonymous write surface (contact form,
  guestbook) into a moderated collection. First crack in default-deny; needs its own
  security design (rate limits, honeypot, quarantine lifecycle). Not first.
- **MCP `resources` primitive** — expose published content as MCP resources, same D18
  ownership argument as prompts.
- **Builder form drops `template` + `bind` on save** — `parseCollectionForm`
  (`src/components/admin/collection-builder.tsx`) rebuilds the whole definition from the
  posted fields and never reads `template`/`bind`, so `updateCollectionRow` overwrites
  those columns with null. Editing e.g. the `articles` collection in the admin builder
  silently strips its reading template. Fix: carry template/bind through the form (hidden
  inputs or a picker) or merge onto the stored def instead of replacing. Surfaced during
  D46; the private-collection work touched the same wholesale-rebuild pattern.
