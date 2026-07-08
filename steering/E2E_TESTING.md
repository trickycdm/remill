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
  .wrangler/state/v3/d1`, then `bun run e2e` (which migrates + seeds + runs). **Corollary: never
  diagnose failures from a bare `bunx playwright test` run** — it skips migrate/seed and reuses
  whatever D1 state is lying around, so it manufactures failures (and can mask real ones) that a
  clean `bun run e2e` doesn't reproduce. Only the clean run is signal (cost a triage detour,
  2026-07-08).

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
├── media/                  # upload (native multipart), alt editing, library browse
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

Accessible-name traps in THIS codebase (each cost a failed run, 2026-07-05/06/08):

- **`FormField` appends "(required)" to the accessible name** — `getByLabel('Name', { exact: true })`
  misses a required field ("Name (required)"). Use an anchored regex: `getByLabel(/^Name/)`.
- **Fixed-pool rows are numbered** (`Key for field 1` … `Key for field 12`, builder TD-10 idiom) —
  non-exact `getByLabel('Key for field 1')` substring-matches fields 10–12 and trips strict mode.
  Row-scoped aria-labels always take `{ exact: true }` (they carry no suffix, so exact is safe).
- **Generated-form labels are HUMANIZED from field keys** (`title` → "Title") — a case-sensitive
  regex like `getByLabel(/^title/)` silently misses it. Anchored label regexes on generated forms
  take the `i` flag: `getByLabel(/^title/i)`.
- **Serial-group retries re-run in a FRESH worker against the SAME D1** — anything the first
  attempt created (collections, teams, accounts) still exists, so re-creates hit "already exists"
  and once-unique names now match twice (strict mode). Derive per-attempt-unique names at module
  scope (`const RUN = Date.now().toString(36)`; fresh worker ⇒ fresh value) and give repeated
  per-card actions team/row-scoped aria-labels (`Mint join link for ${team.name}`).
- **Markdown fields are CodeMirror islands (D38)** — `getByLabel(/^body/i)` strict-violates on the
  PAIR (the hidden carrier textarea + the CM `role=textbox` named by the same label). Fill them
  ONLY via `fillMarkdown` (`e2e/helpers/editor.ts`), which targets the role (the aria-hidden
  textarea is out of the a11y tree, so role queries are unique).
- **Selectable list tables (D39) add checkbox cells named `Select {title}`** — a non-exact
  `getByRole('cell', { name: title })` matches BOTH the title cell and the checkbox cell. Title
  cell locators on selectable lists take `{ exact: true }` (same family as the row-scoped
  aria-label trap above).

## Writing tests

- Descriptive journey names (`'admin creates a collection and adds a text field'`), not technical
  assertions (`'POST /collections returns 200'`). One journey per test; group with `test.describe`.
- Header comment on each spec: what it covers and what regressions it catches.
- Always verify URL after navigation (`await expect(page).toHaveURL('/admin')`).
- **Never `page.waitForTimeout`** — flaky and slow. Wait on the next state instead: for a Datastar
  patch, wait for the patched content/`aria-label` to be visible before interacting.
- Prefer `toBeVisible()` over `toHaveCount(1)`; use `toHaveAccessibleName`/`toHaveRole` where apt.
- **`sr-only` elements COUNT AS VISIBLE to Playwright** (a 1×1 clipped box has a bounding box) —
  `not.toBeVisible()` on an island's hidden carrier fails. Assert the mechanism instead:
  `toHaveClass(/sr-only/)` / `toHaveAttribute('aria-hidden', 'true')`.
- **`page.request` does NOT carry the session cookie in this setup** — an authed admin endpoint
  fetched through it 302s to login. Hit authed endpoints with an in-page
  `page.evaluate(() => fetch(...))` (browser cookies apply); reserve `page.request` for
  anonymous/public surfaces.
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
