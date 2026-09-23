import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.21' } });

// Per-attempt unique title: serial-group retries re-run against the SAME D1.
const runId = Date.now().toString(36);
const TITLE = `Recoverable ${runId}`;

test.describe('D29 — recoverable delete (trash)', () => {
  test('delete moves to trash; restore brings the document back', async ({ page }) => {
    await loginAsAdmin(page);

    // Create a post.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(TITLE);
    await fillMarkdown(page, /^body/i, 'Soon deleted, then restored.');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    // Delete via the editor's confirm dialog.
    await page.getByRole('button', { name: /^Move to trash/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts$/);
    await expect(page.getByRole('cell', { name: TITLE })).toHaveCount(0);

    // It sits in the trash… (exact: the row's action buttons also carry the title)
    await page.goto('/admin/trash');
    await expect(page.getByRole('cell', { name: TITLE, exact: true })).toBeVisible();

    // …and restores under the same id, reappearing in the list.
    await page.getByRole('button', { name: `Restore ${TITLE}` }).click();
    await expect(page).toHaveURL(/\/admin\/trash/);
    await expect(page.getByText(/document restored/i)).toBeVisible();
    await page.goto('/admin/c/posts');
    await expect(page.getByRole('cell', { name: TITLE }).first()).toBeVisible();
  });

  test('delete forever removes the entry permanently', async ({ page }) => {
    await loginAsAdmin(page);
    const goner = `${TITLE} forever`;
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(goner);
    await fillMarkdown(page, /^body/i, 'x');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);
    await page.getByRole('button', { name: /^Move to trash/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await page.goto('/admin/trash');
    await page.getByRole('button', { name: `Delete ${goner} forever` }).click();
    await expect(page.getByText(/deleted forever/i)).toBeVisible();
    await expect(page.getByRole('cell', { name: goner })).toHaveCount(0);
  });
});
