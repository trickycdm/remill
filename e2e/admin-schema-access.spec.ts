import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.12' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Phase 4 — schema builder + access UI', () => {
  test('build a collection in the browser, then author a document in it', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/collections/new');

    await page.getByLabel('Name', { exact: false }).first().fill('Widget');
    // Slug may auto-fill or need entry; set it explicitly if editable.
    const slug = page.getByLabel('Slug', { exact: false }).first();
    if (await slug.isEditable()) await slug.fill('widgets');

    // Mark it Private (D46) — the round-trip below guards the parser, which
    // rebuilds `access` wholesale from the form.
    await page.getByLabel('Visibility').selectOption('private');

    // First field row: key + type. Field 0 inputs are named field_0_*.
    await page.locator('[name="field_0_key"]').fill('name');
    await page.locator('[name="field_0_type"]').selectOption('text');
    // Mark it required + shown in list if those controls exist.
    const req0 = page.locator('[name="field_0_required"]');
    if (await req0.count()) await req0.first().check();

    await page.getByRole('button', { name: /Create|Save/i }).first().click();

    // Landed on the new collection's edit page.
    await expect(page).toHaveURL(/\/admin\/collections\/widgets/);

    // The Private choice survived the save (parser + storage round-trip).
    await expect(page.getByLabel('Visibility')).toHaveValue('private');

    // The collection now appears in the content picker; author a doc.
    await page.goto('/admin/c/widgets/new');
    await page.getByLabel('name', { exact: false }).first().fill('First Widget');
    await page.getByRole('button', { name: /Create Widget/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/widgets\/doc_/);
  });

  // Own bucket: this test's login would otherwise be the one that tips the
  // file's shared SEC-2 login limiter for the later author-role test.
  test.describe('connect wizard (own rate-limit bucket)', () => {
    test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.113' } });

    test('connect wizard: one step mints principal + role + token with per-client cards (D48)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/access');

    // The index is a directory now — one primary action leads to the wizard.
    // (exact: the empty-state hints also link "connect an agent to get started".)
    await page.getByRole('link', { name: 'Connect an agent', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/access\/connect$/);

    // The client select pre-fills the name until the human edits it.
    await expect(page.getByLabel('Agent name')).toHaveValue('claude-code');
    await page.getByLabel('What are you connecting?').selectOption('gemini-cli');
    await expect(page.getByLabel('Agent name')).toHaveValue('gemini-cli');
    await page.getByLabel('Agent name').fill('e2e-bot');
    await page.getByLabel('What are you connecting?').selectOption('claude-code');
    await expect(page.getByLabel('Agent name')).toHaveValue('e2e-bot'); // dirty guard holds

    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    // The form morphs into the one-time reveal + connect cards (no navigation).
    await expect(page.getByText('Access token — copy it now')).toBeVisible();
    await expect(page.getByText(/^rmk_/).first()).toBeVisible(); // the one-time plaintext
    await expect(page.getByText(/claude mcp add --transport http remill/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/access\/connect$/);

    // Tab to .mcp.json — the Claude command hides, the JSON config shows.
    // (id-scoped: the Cursor fallback panel also contains "mcpServers".)
    await page.getByRole('radio', { name: '.mcp.json' }).check({ force: true });
    await expect(page.locator('#connect-snip-mcp-json')).toBeVisible();
    await expect(page.getByText(/claude mcp add --transport/)).toBeHidden();

    // One-time invariant: a reload renders the empty form — the token is gone.
    await page.reload();
    await expect(page.getByLabel('Agent name')).toBeVisible();
    await expect(page.getByText(/^rmk_/)).toHaveCount(0);

    // A "Script / REST API" connection lands as a Service persona.
    await page.getByLabel('What are you connecting?').selectOption('rest');
    await page.getByLabel('Agent name').fill('e2e-puller');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText('Access token — copy it now')).toBeVisible();

    // Back on the directory: one table row per principal, grouped by persona,
    // with a status line.
    await page.goto('/admin/access');
    await expect(page.getByRole('table', { name: 'Agents' }).getByRole('link', { name: 'e2e-bot', exact: true })).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Services' }).getByRole('link', { name: 'e2e-puller', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Never connected/).first()).toBeVisible();

    // Everything about one principal lives on its detail page.
    await page.getByRole('link', { name: 'Manage e2e-puller' }).click();
    await expect(page).toHaveURL(/\/admin\/access\/principals\/prn_/);
    await expect(page.getByRole('heading', { name: 'e2e-puller', level: 1 })).toBeVisible();
    const detailUrl = page.url();

    // Reconnect mode: "New token" mints for the EXISTING principal.
    await page.getByRole('link', { name: 'New token', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/access\/connect\?for=prn_/);
    await page.getByRole('button', { name: 'Mint token', exact: true }).click();
    await expect(page.getByText('Access token — copy it now')).toBeVisible();

    // Narrow the first token's access in the Edit access dialog.
    await page.goto(detailUrl);
    const tokens = page.getByRole('table', { name: /^Tokens for/ });
    await expect(tokens.getByRole('row')).toHaveCount(3); // header + the two tokens
    await expect(tokens.getByRole('row').nth(1).getByText('Full access', { exact: true })).toBeVisible();
    await tokens.getByRole('row').nth(1).getByRole('button', { name: /^Edit access for/ }).click();
    const accessDialog = page.getByRole('dialog', { name: /^Edit access for/ });
    await accessDialog.getByLabel('Read-only').check();
    await accessDialog.getByRole('button', { name: 'Save access' }).click();
    await expect(tokens.getByRole('row').nth(1).getByText('Read-only', { exact: true })).toBeVisible();

    // Revoke the second token through its confirm dialog.
    await tokens.getByRole('row').nth(2).getByRole('button', { name: /^Revoke/ }).click();
    await page.getByRole('dialog', { name: /^Revoke/ }).getByRole('button', { name: 'Revoke token' }).click();
    await expect(tokens.getByRole('row')).toHaveCount(2);

    // Rename in place.
    await page.getByLabel('Name', { exact: true }).fill('e2e-puller-renamed');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('heading', { name: 'e2e-puller-renamed', level: 1 })).toBeVisible();

    // Disable is reversible, so it acts without a confirm.
    await page.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(page.getByText('Disabled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();

    // Delete is confirmed in a dialog, then returns to the directory.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog', { name: /^Delete e2e-puller-renamed/ }).getByRole('button', { name: 'Delete agent' }).click();
    await expect(page).toHaveURL(/\/admin\/access$/);
    await expect(page.getByText('e2e-puller-renamed', { exact: true })).toHaveCount(0);
    });
  });

  test('roles: create a custom role from the closed action vocabulary', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/access');
    await page.getByRole('link', { name: 'Manage roles →' }).click();
    await expect(page).toHaveURL(/\/admin\/access\/roles$/);

    await page.getByLabel('Slug').fill('moderator');
    await page.getByLabel('Name', { exact: true }).fill('Moderator');
    await page.getByLabel('Description').fill('Publish only');
    // The ScopePicker renders the action grid open (advancedOpen) with capitalized
    // labels; checking Publish flips the preset to Custom and submits action=publish.
    await page.getByRole('checkbox', { name: 'Publish', exact: true }).check();
    await page.getByRole('button', { name: 'Create role' }).click();

    // The new custom role appears with its permission and is editable/deletable.
    await expect(page.getByText('moderator', { exact: true })).toBeVisible(); // the slug span
    await expect(page.getByText('Publish only')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('access overview: the matrix shows principals and effective permissions', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/access');
    await page.getByRole('link', { name: /Access overview/ }).click();
    await expect(page).toHaveURL(/\/admin\/access\/matrix$/);

    await expect(page.getByRole('heading', { name: 'Access overview' })).toBeVisible();
    // The bootstrap admin appears in the matrix table (scoped — the name also shows
    // in the top-bar user menu).
    const matrix = page.getByRole('table').first();
    await expect(matrix.getByText('Administrator')).toBeVisible();
  });

  test('share: grant item-level access on a document, then revoke', async ({ page }) => {
    await loginAsAdmin(page);

    // Create a post to share.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel('title').fill('Shared Doc');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    // The Share card (D51) is visible for a manager, split into "Links" and
    // "People & roles" subsections.
    await expect(page.getByText('People & roles', { exact: true })).toBeVisible();

    // Grant read (checked by default) to the reader role, behind the disclosure.
    await page.locator('summary', { hasText: 'Add person or role' }).click();
    await page.getByLabel('Grant to').selectOption('role:reader');
    await page.getByRole('button', { name: 'Grant access', exact: true }).click();

    // The grant now shows with a revoke control.
    await expect(page.getByText('reader', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('No one has item-level access.')).toBeVisible();
  });

  test('invite a person with a password, then sign in as them', async ({ page, context }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/access');

    // The invite form lives behind a disclosure in the People group (D48).
    await page.locator('summary', { hasText: 'Add a person' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Casey Jones');
    await page.getByLabel('Email', { exact: true }).fill('casey@remill.local');
    await page.getByLabel('Password (optional)').fill('caseypass1');
    await page.getByLabel('Initial role').selectOption('editor');
    await page.getByRole('button', { name: 'Add person' }).click();

    // Casey now appears under People.
    await expect(page.getByText('casey@remill.local')).toBeVisible();

    // Fresh session: Casey can sign in with the password the admin set.
    await context.clearCookies();
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill('casey@remill.local');
    await page.getByLabel('Password').fill('caseypass1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin');
  });

  test('invite a person by link (no password): the set-password page activates login', async ({ page, context }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/access');

    await page.locator('summary', { hasText: 'Add a person' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Dana Link');
    await page.getByLabel('Email', { exact: true }).fill('dana@remill.local');
    // Leave the password blank → an invite link is issued and morphed in place
    // (Datastar reveal, no navigation — the address bar stays on /admin/access).
    await page.getByRole('button', { name: 'Add person' }).click();

    await expect(page.getByText('Invitation created — copy the link now')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/access$/);
    const link = (await page.locator('#invite-link-code').innerText()).trim();
    expect(link).toContain('/auth/set-password/');

    // Visit the link in a fresh session and set a password.
    await context.clearCookies();
    await page.goto(link);
    await page.getByLabel('New password').fill('danapass12');
    await page.getByLabel('Confirm password').fill('danapass12');
    await page.getByRole('button', { name: 'Set password' }).click();
    await page.waitForURL('**/admin/login');

    // Dana can now sign in.
    await page.getByLabel('Email').fill('dana@remill.local');
    await page.getByLabel('Password').fill('danapass12');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin');
  });

  test('author role: nav hides admin-only sections and the server denies schema management', async ({ page }) => {
    // Log in as the seeded author human.
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill('author@remill.local');
    await page.getByLabel('Password').fill('authorpass');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin');

    // Nav hides Collections and Access (admin-only) for an author.
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Content' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Collections' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Access' })).toHaveCount(0);

    // Even reaching the builder directly, the server denies the write: submitting
    // the create form (a Datastar @post) hits a 403, so Datastar surfaces the error
    // and the page stays put — no navigation to the new collection.
    page.on('dialog', (d) => d.dismiss().catch(() => {})); // auto-dismiss the dsError alert
    await page.goto('/admin/collections/new');
    await page.locator('[name="name"]').first().fill('Sneaky');
    const slug = page.locator('[name="slug"]').first();
    if (await slug.isEditable()) await slug.fill('sneaky');
    await page.locator('[name="field_0_key"]').fill('x');
    await page.locator('[name="field_0_type"]').selectOption('text');
    await page.getByRole('button', { name: /Create|Save/i }).first().click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/admin\/collections\/new$/); // denied → stayed on the form

    // An author CAN author documents (they have 'create') — the denial is specific.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel('title').fill('Author Made This');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);
  });

  // Own client IP: this file's ~9 logins share one SEC-2 bucket (10/min per
  // CF-Connecting-IP), and this LAST login is the one that tips it — the
  // long-standing "late-suite flake" was the login limiter, not a11y. A separate
  // bucket keeps the sweep deterministic while SEC-2 stays exercised elsewhere.
  test.describe('axe sweep (own rate-limit bucket)', () => {
    test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.112' } });

    test('axe: collections index, builder, and access pages pass WCAG 2.1 AA', async ({ page }) => {
      // Six full axe analyses over data-heavy admin pages (the access matrix grows
      // as the suite accumulates principals/grants) — headroom past the 30s default.
      test.setTimeout(90_000);
      await loginAsAdmin(page);
      for (const path of [
        '/admin/collections',
        '/admin/collections/new',
        '/admin/access',
        '/admin/access/roles',
        '/admin/access/matrix',
        '/admin/settings',
      ]) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.locator('#main-content').first().waitFor();
        const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(r.violations, `axe on ${path}: ${r.violations.map((v) => v.id).join(',')}`).toEqual([]);
      }

      // A principal detail page (the first Manage link — the bootstrap admin at minimum).
      await page.goto('/admin/access');
      await page.getByRole('link', { name: /^Manage / }).first().click();
      await page.locator('#main-content').first().waitFor();
      const detail = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(detail.violations, `axe on ${page.url()}: ${detail.violations.map((v) => v.id).join(',')}`).toEqual([]);
    });
  });
});
