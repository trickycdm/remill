# Plan: agents can read and resolve review comments on documents they can edit (D55 follow-up)

## Context

The user left 10 review comments on an article (`doc_9RLwKkDoq_LzQ5WT6X_h1`) and asked an agent to act on them.
The agent reported that Remill "has no tool for reading comments". That was wrong: `comments_<slug>` and
`get_<slug> render=review` exist and return the author, time, anchor, intent and replies. The real failure was
`FORBIDDEN: Not permitted to comment in 'articles'`:

- Every thread read goes through `authorizeComment()` → `authorize(…, 'comment', …)` (`src/services/comments/index.ts:194`).
  Reading review feedback therefore needs the `comment` action.
- The agent's role holds `comment` only on documents it created itself (`own`). The tool still appears in its list
  (`couldDo` in `src/mcp/tools.ts:95` checks the collection, not the document).
- Each OAuth client registration gets its own agent principal (`src/services/oauth/index.ts:264`). An agent in a new
  session isn't the "owner" of documents an earlier session created, so `own` fails.
- The error text ("Not permitted to comment") on a read call led the agent to wrong conclusions. The agent also has
  no way to see its own identity, role or permissions.

Outcome: anyone who can edit a document can see and close its review feedback. Denials say what's missing, and an
agent can inspect its own identity and permissions.

## Changes

### 1. `update` holders can read and resolve threads (`src/services/comments/index.ts`)

Add one gate beside `authorizeComment`:

```ts
/** Reading and resolving review threads: `comment`, OR `update` on the document —
 *  whoever may edit the text may see (and close) the feedback on it. Posting and
 *  replying stay `comment`-only. Reviewers keep their link's `comment` path. */
async function authorizeThreadAccess(db, viewer, collection, documentId, now): Promise<Grant>
```
- Reviewer viewer → delegate to `authorizeComment` unchanged, so reviewers still never resolve (existing check stays).
- Principal viewer → if `canAuthorize(…'comment'…)` is true, return `authorize(…'comment'…)`. Otherwise, if
  `canAuthorize(…'update'…)` is true, return `authorize(…'update'…)`. Otherwise throw the clearer error from §2.
  `canAuthorize` is the existing non-auditing probe (`src/access/authorize.ts`). The one real `authorize()` call writes
  the audit row, as the moderation check `canModerate` already does.
- Switch these callers to the new gate: `listThreads`, `reviewPanelData`, `renderReview`, `setThreadResolved`,
  `assertResolvable`, `resolveThreads` (if it gates separately).
- Keep `authorizeComment` for `createThread`, `replyToThread`, `setReviewerDone` and `deleteComment`, which already
  special-cases `update` for moderation.
- `threadVisibleTo` is unchanged: principals see all threads, including `internal` ones. `update` holders are always
  principals, so internal notes still never reach reviewers.

### 2. A clear denial on thread reads

Where the new gate refuses, throw `ForbiddenError` with:
`Reading or resolving review threads on this document requires 'comment' or 'update' on it. Call whoami to see your permissions.`
Details: `{ action: 'comment', alternatives: ['update'], collection, documentId }`. Keep the `missing`-style shape the MCP
error mapper already emits. Before calling the probes, run an audited `authorize(…'comment'…)` in a try/catch (or
call it last) so the denial is still audited once. Prefer: probe `comment` and then `update` with `canAuthorize`. If
both fail, call `authorize(…'comment'…)` (which audits and throws), catch its `ForbiddenError`, and rethrow with the
new message.

### 3. MCP tool listing matches the gate (`src/mcp/tools.ts`)

- `comments_<slug>`, `resolve_comment_<slug>`, and the `review` render on `get_<slug>` are listed when
  `couldDo(…'comment'…) || couldDo(…'update'…)`. Name it `canSeeReview` next to `reviewable` (line ~396).
- `comment_<slug>` and `reply_comment_<slug>` stay `comment`-only. The block starting at line 533 splits in two.
- The `resolves` arg on `update_<slug>` is already offered to every `update` holder of an annotatable collection.
  It now also works for them.
- Update the `get_<slug>` comment ("to principals who may comment") and the tool descriptions.

### 4. `whoami` MCP tool (+ REST parity)

An ungated tool, like `list_collections`, placed near line 167 of `tools.ts`:
```json
{ "principal": { "id", "name", "kind", "persona" },
  "roles": [{ "role", "collection" }],
  "permissions": [{ "collection", "action", "condition" }],   // getPrincipalPermissions — already loaded as `perms`
  "tokenScope": [...] | null,
  "oauthClient": "<client name>" | null }
```
- Add a small service `describeSelf(db, principal)` in `src/services/access/index.ts`. It's identity-scoped with no
  `authorize()`, like `/admin/account`. It reuses `getPrincipal` and `getPrincipalPermissions` (`src/db/queries/roles.ts:109`),
  the principal-roles query already used by the access pages, and `persona.ts`. The OAuth client name comes from
  the `oauth_grants` row for this principal: add a narrow query rather than reusing `oauthProvenance`, which is
  `manage_access`-gated.
- REST parity: `GET /api/me` → `src/routes/api/me.tsx` (hono-router file route; run `bun run routes`).
- It returns only the caller's own data, so there's no disclosure beyond what the caller already has.

### 5. Docs

- `steering/ACCESS_CONTROL.md` (§ Closed action vocabulary): `comment` = post and reply. Reading and resolving
  threads = `comment` **or** `update` on the document. Add a one-line reason: whoever may edit the text may see the
  feedback on it.
- `steering/API_AND_MCP_STANDARDS.md` (~line 196): the tool-gating split, plus `whoami` and `/api/me`.
- `src/lib/openapi.ts`: add `/api/me`, and note that the comments `GET` accepts `update`.
- `docs/TECH_DECISIONS.md`: add a short D55 amendment. Don't write a new D-number unless the log's convention
  requires one for a permission change (check first).

## Out of scope (flag to the user, don't build)

- **"Own" is tied to each OAuth client registration.** A new MCP session loses authorship of documents an earlier
  session created. §1 fixes the review case for agents with `update *`, but an `author`-role agent in a new session
  still can't touch its old drafts. This is a separate identity decision (for example, reusing a principal per
  client name or per consenting human).
- `poll_events` stays pointer-only (by design, D33).

## Tests (TDD — write each failing test first)

- `src/services/comments/comments.test.ts`:
  - a principal with `update` but no `comment` (a custom role `update:*` only, or an item grant `['read','update']`)
    can `listThreads`, `renderReview`, `setThreadResolved`, and `resolveThreads` via update, and is refused
    `createThread` and `replyToThread`;
  - a principal with neither gets the new message and details, and the denial is audited;
  - reviewers still can't resolve (the existing test keeps passing).
- `src/mcp/mcp.test.ts`:
  - an update-only token lists `comments_*`, `resolve_comment_*` and `render: review`, and doesn't list `comment_*`
    or `reply_comment_*`;
  - `whoami` returns the principal, roles, permissions and token scope for a scoped token;
  - `update_<slug>` with `resolves` works for an update-only principal.
- REST: `GET /api/me` returns the same shape; `GET …/comments` works for an update-only token.

## Verification

1. `bun run type-check && bun run lint && bun run test:run`.
2. `bun run dev`, then over MCP with a locally minted token for a custom role holding `read,update` on `articles`:
   `whoami` → `comments_articles` → `get_articles render=review` → `update_articles` with `resolves`. Also confirm
   `comment_articles` is absent.
3. After merge and release: re-run `comments_articles` on `doc_9RLwKkDoq_LzQ5WT6X_h1` from this session. It works
   if this principal has `update` there; `whoami` shows whether it does. If it doesn't, the answer is an item grant
   or a role change, not code.

## Commit

One `feat(review)` commit on `trickycdm/review-discoverability` explaining the permission change and why (Angular
conventions, attribution line).
