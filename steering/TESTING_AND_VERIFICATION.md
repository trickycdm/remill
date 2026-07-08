# Testing & Verification

> **STATUS: IMPLEMENTED (in force).** **Vitest 3** + the D1 harness are live with a green suite
> (`bun run test:run`); the schema-engine and access-control tests are in place. These rules govern
> every test written.

Write the test, prove it works, then check the diff before declaring victory. These three are one
continuous discipline. **Every task in the plan carries a runnable verification** — the phase
verifications in `plans/2026-07-04-cms-foundation/plan.md` are the acceptance bar; unit tests are how
you meet them.

## Layers

| Layer | Tool | What it covers |
|---|---|---|
| Unit | **Vitest 3** | Field-type validators, the save pipeline, `authorize()` decisions, Zod schemas, pure transforms, row↔domain mapping |
| Integration | **Vitest 3** + D1 harness | Service logic against a real in-memory SQLite DB — save → index sync → revision append, permission-filtered lists |
| E2E | **Playwright** | Admin user journeys, auth flows, route protection, the axe a11y sweep — see E2E_TESTING.md |

- Tests co-locate under `__tests__/` next to the code they cover. Fixtures live in
  `src/test/fixtures.ts`. Setup (`src/test/setup.ts`) mocks `@/lib/logger` and env access so runs are
  deterministic and quiet.
- Run: `bun run test:run` (CI/one-shot), `bun run test` (watch), `bun run e2e` (Playwright).

## The D1 test harness (better-sqlite3)

D1 is SQLite, so unit/integration tests run against a **real in-memory SQLite database via
`better-sqlite3`** — not a mock. This exercises the actual Drizzle queries, CHECK constraints, UNIQUE
constraints, FK cascades, and `db.batch()` atomicity.

- The `createTestD1()` helper in `src/test/d1.ts` opens an in-memory SQLite instance, applies the
  Drizzle migrations, and returns a binding the query layer accepts. Each test (or `describe`) gets a
  fresh DB — **no shared mutable state between tests.**
- Assert real side effects: after a save, query `document_index` and `document_revisions` directly and
  assert the rows exist. Don't assert on internal function calls — assert on the database.
- Where a service needs a `Grant` witness, use the **single sanctioned `grantForTest()` helper** in
  `src/test/` — never replicate the `Grant` constructor (that would defeat the compile-time guarantee;
  see ACCESS_CONTROL.md).
- **The shim's statement methods must stay Promise-shaped** (like real D1): drizzle's raw-query path
  (`db.all(sql)`) chains `.then()` directly on `stmt.bind().all()` instead of awaiting, so a bare
  sync return breaks it. The one exception is `batch()`, whose better-sqlite3 transaction callback
  must remain synchronous — it uses the internal `allSync()` core (see `src/test/d1.ts`).
- Vitest may print `close timed out after 10000ms … something prevents Vite server from exiting`
  after a green run — a harmless teardown nag, not a failure. Trust the pass/fail summary.

## Property test: the whitelist guarantee (the anti-mass-assignment proof)

The most important invariant in remill — *undeclared fields are always rejected on every write path* —
is proven with a **property test**, not just examples:

- Generate arbitrary payloads that mix declared field keys with random undeclared keys (fast-check or
  equivalent). Assert the save pipeline **rejects** any payload containing a key not in the collection
  definition, for **every surface entry point** (admin, REST, MCP all funnel through the same pipeline).
- This is the direct, permanent guard against Blogmill's mass-assignment hole (SECURITY_STANDARDS.md
  §1). It must fail loudly if anyone adds a bypass. Never weaken it to "strip and continue."

## Schema-engine round-trip tests

Every field type carries a round-trip unit test (mandated by SCHEMA_ENGINE.md "how to add a field
type"): **config → build validator → validate a value → `toIndex` → `beforeRender`**. A new field type
is not done until this test passes. If a field type has Datastar-reactive edit behaviour, it also gets
a Playwright interaction test (E2E_TESTING.md).

## Access-control tests

- **Permission matrix** (Phase 3): assert every `action × role × condition` cell, with **default-deny
  asserted for every uncovered cell**. A missing cell must deny, and a test proves it.
- **List-leak property test**: for permission-filtered lists, assert paginated results **never** contain
  an unreadable document and that totals match the filtered set — the compiled-SQL-filter guarantee.
  In-memory post-filtering would pass a naive test and leak in production; test through the query.
- **Grant expiry**, and an **audit-row assertion on every allow and every deny path**.

## Compile-time guarantees are tests too

The witness-type discipline (ACCESS_CONTROL.md) means an un-authorized document query **fails to
compile**. Keep a `// @ts-expect-error` fixture proving that a document read without a `Grant` is a
type error — if that fixture ever compiles clean, the guarantee has regressed.

## When to test

| Change type | Required coverage |
|---|---|
| New/changed field type | Round-trip unit test (config → validate → index → render) |
| Service change | Happy path + at least one error path, against the D1 harness |
| New API / MCP surface | Happy path + auth-failure (denied principal) |
| Access-control change | Permission-matrix + list-leak coverage (E2E for role-gated UI) |
| Zod / descriptor change | Boundary tests: min/max, missing required, **extra unknown key rejected** |

## Test discipline

- **Behavioural, not implementation.** Assert outputs and side effects. If a valid refactor breaks the
  test, it was testing implementation — rewrite it.
- **Regression rule — no exceptions.** Fixing a bug means adding a test that fails without the fix and
  passes with it.
- **Fix bugs, never work around them in tests.** A test that passes by avoiding the real interaction
  (clicking a different element to dodge an occluded button) hides a production bug — fix the root cause.
- **Isolated & additive** — don't assert exact counts from seed data; use `nanoid()` for
  test-specific names; no test depends on execution order.

## Verification before completion

Before marking any task complete, run all four:

1. **`bun run type-check && bun run lint`** — zero errors (warnings deferrable, errors block).
2. **Affected tests** — `bun run test:run` for service/lib changes, `bun run e2e` for UI/auth changes.
3. **Self-review the diff** — walk it with unexpected inputs: edge-case logic, missing boundary error
   handling, auth/validation/data-exposure assumptions, duplication of existing code.
4. **Prove it works.** UI → verify in the browser; API → hit it with a real request; data → check the
   DB state. Type-check and tests verify code correctness, not feature correctness — if you can't
   exercise the feature end-to-end, say so rather than claiming success.

## Review focus

Prioritise over syntax/style (lint catches those): logic correctness on edge cases; auth assumptions
(is the write behind `authorize()`? does the whitelist run? could a list leak across roles? — remember
D1 has no RLS); architecture alignment (routes → services → queries → D1, no D1 outside
`src/db/queries/`); duplication; data integrity (atomic `db.batch()` writes, correct JSON
serialisation). See DATABASE_STANDARDS.md and SECURITY_STANDARDS.md.
