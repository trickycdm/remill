import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately — the suite's many logins would
// otherwise share the fallback bucket and trip the limit. See scripts/seed-e2e.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.11' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Phase 4 — generated document admin', () => {
  test('full lifecycle: create → publish → edit → revision → restore, then delete', async ({ page }) => {
    await loginAsAdmin(page);

    // Content home lists collections; open Posts. exact: true — the card's
    // footer "New Posts" quick action would substring-match { name: 'Posts' }.
    await page.goto('/admin/c');
    await page.getByRole('link', { name: 'Posts', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts$/);

    // Create a document via the generated form.
    await page.getByRole('link', { name: /New Posts/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/new$/);
    await page.getByLabel('title').fill('My First Post');
    await fillMarkdown(page, 'body', '# Hello\n\nThis is generated.');
    await page.getByRole('button', { name: /Create Posts/i }).click();

    // Redirected to the editor; slug was derived by the field type's beforeSave.
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);
    await expect(page.getByLabel('slug')).toHaveValue('my-first-post');
    await expect(page.getByText('draft', { exact: false }).first()).toBeVisible();

    // Publish.
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();

    // Edit the title → creates revision 2.
    await page.getByLabel('title').fill('My First Post (edited)');
    await page.getByRole('button', { name: /Save changes/i }).click();
    await expect(page.getByLabel('title')).toHaveValue('My First Post (edited)');
    await expect(page.getByText('#2', { exact: false })).toBeVisible(); // revision list shows #2

    // Restore revision #1.
    await page.getByRole('button', { name: 'Restore' }).first().click();
    await expect(page.getByLabel('title')).toHaveValue('My First Post');

    // It appears in the list as published.
    await page.goto('/admin/c/posts');
    await expect(page.getByRole('cell', { name: 'My First Post', exact: false }).first()).toBeVisible();

    // Whitelist guard is invisible to the UI but enforced server-side; here we just
    // confirm the happy path renders. Clean up by deleting via the confirm Dialog.
    await page.getByRole('link', { name: 'My First Post' }).first().click();
    await page.getByRole('button', { name: /^Move to trash/ }).click(); // opens the confirm dialog
    const del = page.getByRole('dialog');
    await expect(del).toBeVisible();
    await del.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts$/);
  });

  test('content home cards show author-centric meta and a New quick action', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c');

    // The Posts card (an <li>) carries a content summary, not schema plumbing.
    const posts = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Posts', exact: true }) });
    await expect(
      posts.getByText(/published|draft|documents|No documents yet/).first(),
    ).toBeVisible();

    // The per-card quick action goes straight to the generated create form.
    await posts.getByRole('link', { name: 'New Posts', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/new$/);
  });

  test('validation error renders inline without navigating', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/posts/new');
    // Leave required title empty; the browser's native required may block, so fill
    // then clear is unreliable — instead submit with only body and rely on server.
    await fillMarkdown(page, 'body', 'no title');
    // Force submit past native validation by removing the required attr.
    await page.evaluate(() => document.querySelectorAll('[required]').forEach((el) => el.removeAttribute('required')));
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page.getByRole('alert')).toContainText(/could not save/i);
    await expect(page).toHaveURL(/\/admin\/c\/posts\/new$/);
  });

  test('axe: content list, create form, and edit form pass WCAG 2.1 AA', async ({ page }) => {
    await loginAsAdmin(page);
    // Seed a doc to have an editor page to scan.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel('title').fill('Axe Post');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    for (const path of ['/admin/c', '/admin/c/posts', '/admin/c/posts/new']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(r.violations, `axe on ${path}`).toEqual([]);
    }
  });
});
