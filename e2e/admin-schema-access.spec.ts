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

    // First field row: key + type. Field 0 inputs are named field_0_*.
    await page.locator('[name="field_0_key"]').fill('name');
    await page.locator('[name="field_0_type"]').selectOption('text');
    // Mark it required + shown in list if those controls exist.
    const req0 = page.locator('[name="field_0_required"]');
    if (await req0.count()) await req0.first().check();

    await page.getByRole('button', { name: /Create|Save/i }).first().click();

    // Landed on the new collection's edit page.
    await expect(page).toHaveURL(/\/admin\/collections\/widgets/);

    // The collection now appears in the content picker; author a doc.
    await page.goto('/admin/c/widgets/new');
    await page.getByLabel('name', { exact: false }).first().fill('First Widget');
    await page.getByRole('button', { name: /Create Widget/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/widgets\/doc_/);
  });

  test('access UI: create an agent, assign a role, issue a token (shown once)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/access');

    // Create an agent principal.
    await page.getByLabel('New agent identity').fill('e2e-bot');
    await page.getByRole('button', { name: 'Create agent' }).click();
    await expect(page.getByText('e2e-bot')).toBeVisible();

    // Issue a read-only token for it → the plaintext is shown once.
    const card = page.locator('div', { hasText: 'e2e-bot' });
    await card.getByLabel('New token').first().fill('ci-read');
    await card.getByLabel('Scope (narrowing)').first().selectOption('read');
    await card.getByRole('button', { name: 'Issue token' }).first().click();

    await expect(page.getByText('Token issued')).toBeVisible();
    await expect(page.getByText(/^rmk_/)).toBeVisible(); // the one-time plaintext
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

  test('axe: collections index, builder, and access pages pass WCAG 2.1 AA', async ({ page }) => {
    await loginAsAdmin(page);
    for (const path of ['/admin/collections', '/admin/collections/new', '/admin/access', '/admin/settings']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(r.violations, `axe on ${path}`).toEqual([]);
    }
  });
});
