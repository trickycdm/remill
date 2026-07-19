# Access Control

> **STATUS: IMPLEMENTED (Phase 3 engine + Track A management surfaces + sharing fabric v2 — teams
> D24, `share_link` D26).** The choke point + `Grant`
> witness + audit landed in Phase 2 ("born authorized"); the full model — roles-as-data, scoped
> assignments, item grants with expiry, token scope masks, conditions `own`/`published`, publicRead
> sugar, and SQL-compiled list filters — landed in Phase 3. Track A added the management UI: personas,
> invite-a-person, custom-role CRUD, per-collection token scoping, the Share panel, and the access
> matrix. Code: `src/access/` (decision), `src/db/queries/roles.ts` + `grants.ts`,
> `src/services/access/` (management), `src/routes/admin/access/**` (UI). Seeded roles:
> `src/access/policy.ts` (mirrored in `seed.sql`). Default-deny, additive-only, one decision point,
> everything audited. Expressiveness is deliberately traded for auditability (decision D16).

## Principals: humans and agents are the same kind of actor

- Every actor is a **principal** (`kind: 'user' | 'agent'`). Humans authenticate with sessions,
  agents with bearer tokens; **both resolve to a principal before any decision is made**.
- Agents are identities, not shared keys: each autonomous agent gets its own principal, tokens,
  role assignments, and audit trail. Never issue a "team" or "shared" token.
- A built-in `anonymous` principal represents unauthenticated requests.
- **Persona vs. kind (`principals.subtype`).** `kind` is the only *security* axis: `user` (human,
  session, may hold `manage_access`) vs `agent` (machine, token, refused access-management by
  `refuseAgentEscalation`). But a person manages **three personas** — Person, Service, Agent — because
  a data-pulling system and an autonomous AI client are both `kind: 'agent'` yet operationally
  distinct. `subtype` (`'person' | 'service' | 'agent' | null`) records which, for display / grouping /
  filtering **only**. `authorize()` never reads it; the value set is enforced at the service layer
  (`createUser` → `person`, `createAgent(…, subtype)` → `service | agent`), not a DB CHECK. Derive it
  with `personaOf(kind, subtype)` in `src/lib/persona.ts` (legacy null machines read as `agent`).
- Tokens carry an optional **narrowing scope mask**: effective permission = principal's permissions
  ∩ token mask. A token can shrink an agent's blast radius, **never widen it**.

## The model: two additive layers, default deny, no negative rules

1. **Roles** — data-defined (like collections), so least-privilege custom roles can be created at
   runtime from admin UI or MCP. Seeded system roles: `admin`, `editor`, `author`, `reader`,
   `anonymous`. A role holds permission rows `(collection | *, action, condition?)`.
   - **Closed action vocabulary**: `read, create, update, delete, publish, manage_schema,
     manage_access, share_link`. `share_link` (D26) is the narrow right to mint an anonymous,
     expiring, read-only share link for a document — held by `admin`/`editor` system roles by
     default. Extending the vocabulary requires a decision-log entry.
   - **Closed condition enum**: `own` (created_by = principal), `published` (status = published).
     Never arbitrary code. Extending it requires a decision-log entry.
   - Role *assignments* are collection-scopable: `(principal, role, collection | *)` —
     "editor, but only of posts."
2. **Item grants** — per-document tuples `(principal | role | team | link, document_id, actions,
   granted_by, expires_at?)`. Precision layer: "agent `researcher` may `update` document X until
   Friday." Surfaced (Share) on all three doors: the document edit view's **Share panel** (managers
   only — install-wide `manage_access`), the REST `/api/c/:collection/:id/grants` endpoint
   (GET/POST/DELETE), and the generated MCP `share_<slug>` tool (visible only with `manage_access`).
   All route through `grantItem`/`revokeItem`/`listItemGrants`, each
   `authorize('manage_access', {collection, documentId})`-gated.
   - **`team` subjects are AUDIENCES, never capability containers (D24):** a team holds no
     permissions of its own — it only widens who a grant reaches. Membership resolves at decision
     time: `authorize()` and `compileReadFilter` fetch `getPrincipalTeamIds` alongside role slugs,
     and `subjectMatchFor` (`src/db/queries/grants.ts`) gains a `teamIds` branch — `decide()`
     itself is untouched. Teams are managed at `/admin/access/teams`; all team mutations
     (CRUD/membership/invites) are `manage_access`-gated and refuse agents (SEC-8). **Team join
     links** are multi-use invites: `rmj_`-prefixed tokens hashed at rest, expiry required (clamped
     ≤90 days), optional `maxUses`, and a validated role preset (never `anonymous`). Acceptance at
     `/auth/join/:token` is UN-gated — the token IS the credential — and an existing email raises
     `ConflictError`, never a silent account attach. Recipients see their item grants at
     `/admin/shared` ("Shared with me", identity-scoped `listSharedWithMe`).
   - **`link` subjects are SHARE LINKS (C3):** `subjectId` is the SHA-256 hash of an `rms_…` token
     (plaintext shown once at mint). Minting (`createShareLink`) is gated by the `share_link`
     action (D26) — not `manage_access`, and NOT agent-refused — so an agent deliberately granted
     `share_link` (via a role or a one-document item grant) may mint links. The
     public `/s/:token` route resolves the hash to the grant and reads through the SAME
     `authorize()` path, with the link identity carried as `Principal.linkId` — an EXPLICIT match
     branch in the grant queries, never disguised as a principal id, so the matrix and audit stay
     honest. Expiry and revocation are the ordinary item-grant mechanics; unknown/expired/revoked
     all resolve identically (no enumeration oracle). A link grants its one document and nothing
     else — additive, like every grant.

There are **no negative rules**. If you can't express a policy additively, the policy is wrong for
this system — do not add deny rules.

**Legibility is part of the model.** The consolidated access overview at `/admin/access/matrix`
renders the effective-permission matrix (principal × collection, from `getPrincipalPermissions` +
role assignments) plus every active item grant and token scope — the read-only answer to "who/what
can touch what." When you add a new grant kind or scope mechanism, it must show up there too —
team grants render with their resolved team names, not opaque ids.

Media rides collection permissions (upload = `create` on the `media` collection). A collection's
`access.publicRead` flag is sugar for: `anonymous` gets `read` with condition `published`. Its
sibling `access.private` (D46) governs **discovery visibility**, not content: a private collection
is omitted from every discovery surface (REST/MCP collection list+get, `/api/openapi.json` paths,
pack installed-status) for principals who hold neither `manage_schema` nor a **role/token-scope
`read`** on it. Item grants deliberately do NOT confer discovery — an item-grant-only principal
reaches its document via `/s/:token` or "Shared with me", never by enumerating the collection
(matching MCP tool visibility, which also ignores item grants). `publicRead` and `private` are the
**two** collection-level access fields and are **mutually exclusive** (rejected together on write);
neither changes document authorization, which was already deny-by-default. Collection-scoped
permissions are still expressed only with `role_permissions` + collection-scoped `principal_roles`,
the single mechanism the authorizer consumes. An inline `access: { <role>: [actions] }` map is
rejected on write (it was once stored and silently ignored — a removed security smell).

The capability rule lives in ONE place — `canDiscover` in `services/collections`, fed by
`collectionsWithActionFrom` (the pure half of `collectionsWithAction`, so discovery resolves the
principal's permissions once and derives both `manage_schema` and the readable set — TD-3). Every
discovery surface routes through `listCollectionsForDiscovery` / `getCollectionForDiscovery` /
`listDiscoverableCollections`; a hidden collection returns `null`/absent, indistinguishable from
nonexistent, so discovery is no enumeration oracle.

## Tables (fixed, Drizzle-migrated)

`principals`, `roles`, `role_permissions`, `principal_roles`, `item_grants`, and append-only
`audit_log` (principal, token, surface `admin|rest|mcp`, action, resource, allow/deny, timestamp).
See DATABASE_STANDARDS.md.

## One decision point, structurally unbypassable

`authorize(principal, action, resource)` in `src/access/` is **the only place** an allow/deny is
computed. Admin, REST, and MCP all pass through it — one pipeline, three doors. Two mechanisms
make bypass a compile error, not a convention:

- **The witness type.** Query functions that read or mutate documents require a `Grant` value as a
  parameter, and only the access module can construct one (unexported class / brand). A service
  that skips `authorize()` does not compile. Test code uses a single sanctioned
  `grantForTest()` helper in `src/test/` — never replicate the constructor.
- **Compiled list filters.** For list/search, the access module compiles the principal's
  permissions into SQL predicates (`status='published' OR created_by=? OR id IN (grants…)`)
  applied **inside the query**. **Never post-filter in memory** — that leaks unreadable items
  through pagination and miscounts totals.

## Structured denials

Denials return `403 { error, code: 'FORBIDDEN', missing: { action, collection } }` so an agent can
reason about what it lacks instead of retrying blindly. Same shape on all three surfaces (MCP maps
it into the tool error payload).

## Audit

The trail is READABLE (completion-roadmap Phase 4): `/admin/activity` (filters + keyset paging),
the dashboard recent-activity card, REST `GET /api/audit`, and the MCP `list_audit` tool — all
through `access.listAuditPage`, all gated `manage_access`. Rows carry a denormalized `collection`
column (stamped by `authorize()`; NULL on rows predating it) because the `resource` string for a
document doesn't name its collection. Token liveness: `resolvePrincipal` stamps
`api_tokens.last_used_at` on every authenticated REST/MCP call; the Access page surfaces it per
token ("used …"/"never used").

Every allow **and** every deny writes an `audit_log` row attributing principal, token (if any),
surface, action, and resource. Audit writes are append-only — no update or delete path exists in
code. The audit log is itself readable only with `manage_access`.

## Non-negotiables

- `manage_access` is held by humans by default. Agents never perform access-management
  **mutations** — `assignRole`, `issueToken`, `createUser`, `createAgent`, and all team
  CRUD/membership/invite operations are `refuseAgentEscalation`-guarded; granting an agent
  `manage_access` requires a human decision recorded in the audit log. The one deliberate
  carve-out is `share_link` (D26): minting an expiring read-only link on a single document is a
  separately grantable action a human MAY hand to an agent — it is not escalation, because the
  link never grants more than that one document's read.
- Permission resolution happens **once per request**, is carried on the request context, and is
  never read from client input (no role-in-cookie-payload, no role-in-body).
- MCP tool listing is intersected with the connecting principal's effective permissions — an agent
  without `publish` never sees `publish_<slug>`. Capability discovery IS permission discovery.
- "Agent proposes, human approves" is expressed with the permission model (grant `create` + `update`
  with condition `own`, withhold `publish`) — never build a parallel workflow engine.
- **Identity-scoped self-service edits skip `authorize()`/`Grant`** — the identity IS the
  authorization. `/admin/account` (a human editing their own profile/password) operates strictly on
  the session principal (`getUser(c).id`), **never a body-supplied id**, so there is no cross-principal
  access to gate. Editing *other* principals stays under `manage_access`. (Password change: verify the
  current password first — SECURITY_STANDARDS §4.)
- **Un-gated reads are a narrow, explicit exception** for render-path config that non-readers still
  need: `getSettings()` reads the `settings` singleton's non-sensitive display fields via a witness-free
  query (mirroring `collectionPublicRead`). WRITES to settings still run the full `authorize()`-gated
  document pipeline. Do not widen this to document content.
- **Trash (D29): `delete` on the collection gates the whole surface** — who can delete can list,
  restore, and destroy those snapshots; no new action. Listing compiles the caller's own/published
  delete-conditions into the query (`TrashScope`, mirroring `compileReadFilter` — never post-filter);
  restore/destroy authorize the ITEM decision with the snapshot's `createdBy`/`status`, so conditions
  evaluate exactly as against the live document. Metadata-only helpers (`getTrashMeta`,
  `trashedCollections`) are witness-free (getDocumentMetaForAuth precedent); full snapshot reads
  demand a Grant.
- **Read-scoped aggregates reuse `compileReadFilter` — never mirror it.** The content-home
  overview (`contentOverview` → `countDocumentsByCollection`) compiles the SAME predicate
  `listDocuments` uses into its grouped count query, so counts always agree with list totals
  and can never leak drafts to conditioned readers (D17). Mirror-shaped scopes (`TrashScope`)
  exist only for actions with no compiled filter of their own (`delete`); any surface counting
  or summarizing what a principal can *read* reuses the real filter.
- **Witness-free maintenance (D31)**: retention purges (trash; later events) run from cron with no
  principal — they are maintenance, not authorization decisions, so they are witness-free query
  functions and write NO audit rows. Keep this category to deletions of derived/expired state; a
  cron job that touches live content must act as the SYSTEM actor (below).
- **The system actor (D30)** is how cron touches live content: `systemPrincipal()` =
  `{id:'system', kind:'system', surface:'system'}` — NO principals row, NO seeded permissions, and
  never constructed in a request handler. `authorize()` allows it BY KIND (permission resolution is
  skipped; there is nothing to resolve) but **still writes the audit row** — "authorize is the only
  audit writer" survives, and every scheduled action is attributed (surface `system`) in
  /admin/activity. Two consequences of "no DB row": revisions it writes carry `saved_by` NULL (the
  audit row is the attribution), and it can never be assigned roles, issued tokens, or narrowed by
  scope — which is the point: the drain must not be breakable by an access-management edit. The
  scheduled-publish drain (`drainScheduledPublishes`) selects due drafts witness-free (metadata
  only) and then runs each through the FULL `setPublished` pipeline as the system actor — the
  witness-free part is only ever the SELECTION, never the mutation.
- **Capability pre-checks don't replace authorize()**: `collectionsWithAction` (services/access)
  scopes cross-collection surfaces (trash; later events) WITHOUT spraying deny rows into the audit
  log, but every included collection is still `authorize()`d for its Grant and every action taken
  is an item-level decision.

## Deferred: field-level access

Per-field `access: { read: [roles], write: [roles] }` composes with the whitelist pipeline
(writable = whitelist ∩ permitted; unreadable stripped at render). Deferred post-v1 for admin UX
cost; the descriptor hook point is reserved (see SCHEMA_ENGINE.md). Do not repurpose it.
