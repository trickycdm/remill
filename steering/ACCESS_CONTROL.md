# Access Control

> **STATUS: IMPLEMENTED (Phase 3).** The choke point + `Grant` witness + audit landed in Phase 2
> ("born authorized"); the full model — roles-as-data, scoped assignments, item grants with expiry,
> token scope masks, conditions `own`/`published`, publicRead sugar, and SQL-compiled list filters —
> landed in Phase 3. Code: `src/access/` (decision), `src/db/queries/roles.ts` + `grants.ts`,
> `src/services/access/` (management). Seeded roles: `src/access/policy.ts` (mirrored in `seed.sql`).
> Default-deny, additive-only, one decision point, everything audited. Expressiveness is deliberately
> traded for auditability (decision D16).

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
     manage_access`. Extending it requires a decision-log entry.
   - **Closed condition enum**: `own` (created_by = principal), `published` (status = published).
     Never arbitrary code. Extending it requires a decision-log entry.
   - Role *assignments* are collection-scopable: `(principal, role, collection | *)` —
     "editor, but only of posts."
2. **Item grants** — per-document tuples `(principal | role, document_id, actions, granted_by,
   expires_at?)`. Precision layer: "agent `researcher` may `update` document X until Friday."

There are **no negative rules**. If you can't express a policy additively, the policy is wrong for
this system — do not add deny rules.

Media rides collection permissions (upload = `create` on the `media` collection). A collection's
`access.publicRead` flag is sugar for: `anonymous` gets `read` with condition `published`.

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

Every allow **and** every deny writes an `audit_log` row attributing principal, token (if any),
surface, action, and resource. Audit writes are append-only — no update or delete path exists in
code. The audit log is itself readable only with `manage_access`.

## Non-negotiables

- `manage_access` is held by humans by default. Agents must not be able to escalate themselves or
  each other; granting an agent `manage_access` requires a human decision recorded in the audit log.
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

## Deferred: field-level access

Per-field `access: { read: [roles], write: [roles] }` composes with the whitelist pipeline
(writable = whitelist ∩ permitted; unreadable stripped at render). Deferred post-v1 for admin UX
cost; the descriptor hook point is reserved (see SCHEMA_ENGINE.md). Do not repurpose it.
