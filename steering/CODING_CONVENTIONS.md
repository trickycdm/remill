# Coding Conventions

> **STATUS: IMPLEMENTED (in force).** The full `src/**` layout exists and follows these conventions;
> the paths below (`src/services/`, `src/db/queries/`, …) are real. The rules bind every
> TypeScript/TSX change.

The rules every TypeScript/TSX change must follow. remill is a **single standalone package** — not a
monorepo. There is no turbo, no workspaces, no `surfaces/`; one `package.json` at the repo root, one
`src/` tree. **Bun is the package manager and runner** (`bun install`, `bun run <script>`).

## The layering invariant (non-negotiable)

**Routes and Durable Objects never touch D1 directly.** Every data path is:

```
Routes / DOs  →  Services (src/services/)  →  Queries (src/db/queries/)  →  D1
```

- **Queries are the only layer that imports Drizzle.** Row↔domain mapping (JSON parse/serialise, 0/1↔bool)
  is private to `src/db/queries/`. Nothing above it sees a raw row or a Drizzle builder.
- **Services hold all business logic *and* all authorization.** D1 has no RLS — every ownership/role
  check lives in a service, routed through `authorize()` (see ACCESS_CONTROL.md). A service is where
  validation, transforms, the save pipeline, and the audit write happen.
- **Routes stay thin: parse, call, render.** Parse the request (throw `BadRequestError` on bad JSON),
  call one service function, render the result (JSX, JSON, or a Datastar response). No logic, no D1.
- **DOs (the MCP agent) call services too** — never queries, never D1. The witness-type discipline in
  ACCESS_CONTROL.md makes an un-authorized document read a compile error, so this holds structurally.

## File layout under `src/`

| Path | Holds |
|---|---|
| `src/routes/**` | File-based routes (`hono-router` codegen → `src/router.ts`). One file per route. |
| `src/services/` | Business logic + authorization. The only caller of the queries layer. |
| `src/db/queries/` | The sole Drizzle importer. Row↔domain mapping. |
| `src/db/schema.ts`, `src/db/migrations/` | Fixed-table schema (see DATABASE_STANDARDS.md) + generated SQL. |
| `src/fields/` | Field-type registry, one module per type (see SCHEMA_ENGINE.md). |
| `src/access/` | `authorize()` + the `Grant` witness type. The only place allow/deny is computed. |
| `src/lib/` | Cross-cutting utilities: `errors.ts`, `logger.ts`, `validation.ts`, `datastar-response.ts`, `json-for-script.ts`, `auth.ts`. |
| `src/components/` | Owned admin component library (Hono JSX). |
| `src/client/` | JS islands compiled by Vite (CodeMirror markdown editor, media picker — D38) — only where Datastar can't reach. |
| `src/mcp/` | Thin wrapper over the `agents` SDK registration surface. |
| `src/config/` | `constants.ts` (shared thresholds), env access. |
| `src/test/` | Fixtures, setup, the single sanctioned `grantForTest()` helper. |

## Style and structure

- **Functional programming** — no classes, no `this`. The single exception is `src/lib/errors.ts`
  (the `AppError` hierarchy needs state + runtime `instanceof`; give it an explicit ESLint override).
- **Explicit types** — no `any`; declare return types on exported functions. Use `unknown` at
  boundaries and validate with Zod. TypeScript runs in `strict` mode.
- **Descriptive names** — action-oriented function names (`createDocument`, not `create`). Constants
  describe intent, not value.
- **Namespaced imports** — `import * as documentService from '@/services/documents'`. Call sites read
  like prose (`documentService.create(...)`) and grep-for-callers is trivial.
- **Constants** — shared thresholds in `src/config/constants.ts`. Never inline a magic number twice.

## IDs

- **nanoid for every primary key**, prefixed by entity type (`doc_`, `col_`, `med_`, `rev_`, `tok_`,
  `prn_`). Prefixes make IDs self-describing in logs and prevent cross-entity confusion.
- nanoid uses `crypto.getRandomValues()` — cryptographically secure, non-sequential, enumeration-safe.
  Never use auto-increment integers as external IDs.

## Logging

- **Console-based structured logger** — `getLogger('service-name')` returns a Pino-compatible
  interface backed by `console.*` (Workers captures `console.*` as structured JSON with observability
  enabled). **This is NOT Pino** — do not import `pino`. Metadata object always first:
  `log.info({ documentId, collection }, 'saved document')`.
- **PII discipline** — log stable IDs, never emails, names, or document content.

## Hono JSX components

- **No hooks, no client React** — Hono JSX components are plain functions returning JSX, rendered
  server-side on every request. There is no `useState`/`useEffect`/`useRef`.
- **Client interactivity** via Datastar attributes and `@post`/`@get`/`@delete` actions with SSE
  patches from the server. Browser APIs Datastar can't express (CodeMirror, the media picker) become TypeScript
  islands in `src/client/`. See DATASTAR_PATTERNS.md.

## Database access

- **No N+1 queries** — never loop fetching related rows one at a time. Add a batch loader in
  `src/db/queries/` (`inArray()`), pre-fetch once, pass down. See DATABASE_STANDARDS.md.

## Reuse and dependency hygiene

- **Reuse before writing.** Search `src/lib/`, `src/components/`, `src/services/`, and `src/fields/`
  before creating a new utility, component, service, or field type. AI-generated code biases toward
  new files — resist it.
- **Dependency hygiene.** Never import a package not already in `package.json` without confirming it
  exists on npm and is genuinely needed. Hallucinated package names are a real supply-chain risk
  ("slopsquatting"). Run `bun audit` before adding a dependency.
- **No architecture by autocomplete.** Don't generate micro-abstractions, wrapper layers, or helper
  files without a concrete immediate need. Every new file justifies its existence. (The deleted MCP
  tool-framework in the reference repo is the cautionary tale — tools are generated directly from
  collection definitions, not routed through an indirection.)

## Specific load-bearing rules

- **`||` not `??` for user-facing fallbacks.** `user.displayName || user.email` — `||` lets empty
  strings (`''`) fall through to the fallback; `??` only catches `null`/`undefined`, and an empty
  string can trip a downstream `z.string().min(1)`.
- **Size algorithms to the Worker's 128 MB ceiling, not to Big-O alone.** An O(n·m)-MEMORY
  structure over user-sized input is a production OOM, not a perf nit — a 5000²-line LCS DP table
  is ~100 MB. Shrink the problem first (trim shared prefix/suffix), use compact typed arrays
  (`Uint16Array`), and hard-cap the core with a graceful "too large" fallback
  (`src/lib/diff.ts` is the worked precedent).

## When in doubt

If a rule here conflicts with existing code, the convention is usually right and the code is stale —
flag it. If a new pattern emerges the rules don't cover, add a row here rather than re-deriving the
answer in three places.
