# E2E Testing Standards

> **STATUS: IMPLEMENTED.** The Playwright suite (+ axe sweeps) is live in `e2e/` (`bun run e2e`).
> Playwright drives the styled admin end-to-end. Tests are primarily authored and debugged by AI
> agents using the `playwright-cli` skill.

## Why E2E is not optional here (the load-bearing rationale)

**Datastar reactive expressions are opaque strings the type-checker cannot see.** `data-computed`,
`data-bind`, `data-show`, `data-text`, and `data-on:*` expressions are plain text in an HTML attribute
— neither `type-check` nor Vitest (which asserts *server-rendered* HTML) can tell whether a reactive
expression actually works in a browser. A broken signal reference, a frozen computed-from-computed
(DATASTAR_PATTERNS.md), a busy flag that never clears — **all of these pass type-check and unit tests
and only fail at runtime.**

Therefore **Playwright is the only safety net for every interactive admin flow.** It is not an
afterthought or a nice-to-have: every generated edit form, every dirty/busy signal, every inline
validation patch, every drawer/dialog must have an e2e test that drives it in a real browser and
asserts the rendered result. E2E complements Vitest (below); it does not replace it.

| Layer | Tool | What to test |
|---|---|---|
| Unit / integration | Vitest | Field validators, save pipeline, `authorize()`, Zod schemas, query mapping |
| E2E | Playwright | Admin journeys, auth/route protection, **all Datastar interactivity**, responsive layout, a11y |

**Principles:** test real user flows, not implementation details; mock only at system boundaries
(R2/external) — never internal services; one journey per test; tests isolated (no shared mutable
state); v1 makes **no AI/LLM calls**, so there is nothing to mock there.

## Setup

```bash
bun add -D @playwright/test @axe-core/playwright
npx playwright install chromium          # single browser for speed
```

Add `"Bash(playwright-cli:*)"` to `.claude/settings.local.json` `permissions.allow`. Install the
`playwright-cli` skill (`playwright-cli install --skills`) — it teaches the snapshot workflow, element
targeting, and debugging patterns and is required for AI-driven test development.

`playwright.config.ts` at the repo root is authoritative. The load-bearing choices (don't relearn
these):

- **The suite runs against a BUILT PREVIEW** (`bun run build && bun run preview` → workerd on
  `http://127.0.0.1:3100`), NOT `vite dev`. The dev server's on-demand SSR compile degrades under a
  long serial suite; the preview serves the production bundle from the same `.wrangler/state` local
  D1 the seed scripts populate, and halved the suite's wall-clock (2026-07-05).
- **Serial, one worker.** All specs share one server + one local D1; parallel workers collide on
  shared state (unique slugs, seeded rows). Correctness over speed.
- **Every spec file sets its own `CF-Connecting-IP`** (`test.use({ extraHTTPHeaders })`, distinct
  203.0.113.x per file) so the SEC-2 login limiter (10/min/IP) buckets files separately — and a
  file with ~10+ `loginAsAdmin` calls must give login-heavy tests a nested-describe bucket of their
  own. **The long-standing "late-suite axe flake" was this limiter, not a11y and not timing** —
  when a login-dependent test fails late in a fast suite, check the 429 path FIRST (2026-07-05).
- **Not idempotent.** Reset before a full run: kill any server on :3100, `rm -rf
  .wrangler/state/v3/d1`, then `bun run e2e` (which migrates + seeds + runs).

Prerequisites are wrapped by `bun run e2e`: local D1 migrated + seeded (first admin, `settings` +
`media` collections, roles, e2e fixtures).

## Directory structure

```
e2e/
├── global-setup.ts        # log in seed principals, save storageState to .auth/*.json (gitignored)
├── global-teardown.ts     # remove .auth state files
├── fixtures/test.ts        # base test export with role-specific page fixtures
├── auth/                   # login, redirect-after-login, invalid creds, route protection
├── collections/            # schema builder: create/edit a collection and fields via the UI
├── documents/              # generated list + edit view, draft/publish, revision restore
├── media/                  # upload (Uppy), alt editing, library browse
├── access/                 # principals, roles, tokens, item grants, audit log
├── a11y/pages.spec.ts      # axe sweep across every admin page
└── smoke.spec.ts
```

## Auth strategy

Session state is a `hono-sessions` **encrypted cookie**. `global-setup.ts` logs each seed principal in
through the real `/admin/login` page and saves browser state to `.auth/*.json`:

```ts
async function loginAndSave(page, email, password, statePath) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('/admin');
  await page.context().storageState({ path: statePath });
}
```

Spec files import `{ test, expect }` from `e2e/fixtures/test.ts` — **never from `@playwright/test`
directly**. Fixtures map to remill's seeded roles (ACCESS_CONTROL.md):

| Fixture | Auth context | StorageState |
|---|---|---|
| `page` | `admin` (default) | `.auth/admin.json` |
| `authorPage` | `author` — least-privilege, condition `own`, no publish | `.auth/author.json` |
| `anonymousPage` | none | empty |

The `author` fixture exists specifically to prove the Phase 4 governance guarantee: the UI **hides**
out-of-role actions **and** the server **denies** them (a permission-aware admin never shows a button a
principal can't use; the deny is still asserted at the API). Never click the real sign-out button in a
test other tests depend on — it clears the shared cookie; clear cookies directly with
`page.context().clearCookies()`. Unauthenticated tests must
`test.use({ storageState: { cookies: [], origins: [] } })` to drop the default session.

## Locator strategy (matches the WCAG 2.1 AA commitment)

Priority: **1** `getByRole` (buttons, links, headings, nav) → **2** `getByLabel` (form fields) → **3**
`getByText` (content, empty states) → **4** `getByTestId` (complex/dynamic containers). CSS selectors,
XPath, and positional selectors are discouraged — brittle and they don't validate accessibility. New
`data-testid`s use `<feature>-<element>` (e.g. `document-list`, `field-editor-body`).

## Writing tests

- Descriptive journey names (`'admin creates a collection and adds a text field'`), not technical
  assertions (`'POST /collections returns 200'`). One journey per test; group with `test.describe`.
- Header comment on each spec: what it covers and what regressions it catches.
- Always verify URL after navigation (`await expect(page).toHaveURL('/admin')`).
- **Never `page.waitForTimeout`** — flaky and slow. Wait on the next state instead: for a Datastar
  patch, wait for the patched content/`aria-label` to be visible before interacting.
- Prefer `toBeVisible()` over `toHaveCount(1)`; use `toHaveAccessibleName`/`toHaveRole` where apt.
- Scope locators when text repeats (`page.locator('#main-content').getByText(...)`) and use
  `{ exact: true }` when a name is a substring of a sibling's.
- Isolate: don't assert exact seed counts; `nanoid()` for test-specific names; reset local D1 with
  `bun run db:migrate` if state drifts.

## Accessibility sweep

`e2e/a11y/pages.spec.ts` runs `@axe-core/playwright` against every admin page and asserts zero
violations. **Every new admin page is added to this sweep.** Aligns with A11Y_STANDARDS.md (WCAG 2.1 AA).

```ts
for (const { name, path, auth } of pages) {
  test(`${name} has no a11y violations`, async ({ page, anonymousPage }) => {
    const p = auth ? page : anonymousPage;
    await p.goto(path);
    expect((await new AxeBuilder({ page: p }).analyze()).violations).toEqual([]);
  });
}
```

## playwright-cli for development & debugging

Use `playwright-cli` for exploration/debugging, not as the runner — always write real `.spec.ts`
files. Workflow: `open` a URL → `snapshot` (YAML a11y tree with element refs like `e15`) → interact
by ref (`fill e5 "…"`, `click e12`) → `snapshot`/`console` to verify. Prefer `snapshot` over
`screenshot` (text-based, far more token-efficient). To debug a failure, run the test in background
with `PWPAUSE=cli` and attach via `--session=test`.

## CI

`PLAYWRIGHT_HTML_OPEN=never bun run e2e`. Chromium only; single worker (`workers: 1`) for
predictability; the config's `webServer` block starts the Vite dev server. Timeouts: test 30s, action
10s, navigation 15s (Vite first-route cold compile), web-server startup 30s. Screenshots/traces/reports
land in gitignored `test-results/` and `playwright-report/`.

## What NOT to E2E test

These belong in Vitest: pure business logic (field validators, transforms, the save pipeline),
Zod schemas, query-layer internals (row mapping, batch functions), `authorize()` decision logic
(permission matrix), individual component rendering in isolation, API/MCP response shapes (test via
service-level integration tests against the D1 harness).
