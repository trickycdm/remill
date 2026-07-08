import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.29' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Per-attempt unique titles: serial-group retries re-run against the SAME D1.
const runId = Date.now().toString(36);
const T1 = `Bulk one ${runId}`;
const T2 = `Bulk two ${runId}`;

async function createPost(page: import('@playwright/test').Page, title: string): Promise<void> {
  await page.goto('/admin/c/posts/new');
  await page.getByLabel(/^title/i).fill(title);
  await fillMarkdown(page, /^body/i, 'bulk fodder');
  await page.getByRole('button', { name: /Create Posts/i }).click();
  await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);
}

test.describe.serial('D39 — bulk actions', () => {
  test('select rows → publish, then unpublish; badges toggle; axe-clean with the bar', async ({ page }) => {
    await loginAsAdmin(page);
    await createPost(page, T1);
    await createPost(page, T2);

    await page.goto('/admin/c/posts');
    // Keyboard-operable row checkboxes: focus + Space.
    const row1 = page.getByRole('checkbox', { name: `Select ${T1}` });
    await row1.focus();
    await page.keyboard.press('Space');
    await expect(row1).toBeChecked();
    await page.getByRole('checkbox', { name: `Select ${T2}` }).check();

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations, `axe on selectable list: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(/Bulk action: 2 done\./);

    // Both rows now carry the published badge (scope to our rows via aria-label cells).
    for (const t of [T1, T2]) {
      const row = page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Select ${t}` }) });
      await expect(row.getByText('published', { exact: true })).toBeVisible();
    }

    // Unpublish just one.
    await page.getByRole('checkbox', { name: `Select ${T1}` }).check();
    await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(/1 done\./);
    const row = page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Select ${T1}` }) });
    await expect(row.getByText('draft', { exact: true })).toBeVisible();
  });

  test('select-all → move to trash; rows land in /admin/trash; empty selection flashes', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/posts');

    // Submitting with nothing ticked is a friendly flash, not an error.
    await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(/Nothing selected/);

    // Select-all ticks every row checkbox on the page.
    await page.getByRole('checkbox', { name: 'Select all rows' }).check();
    await expect(page.getByRole('checkbox', { name: `Select ${T1}` })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: `Select ${T2}` })).toBeChecked();

    await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(/Bulk action: \d+ done\./);
    await expect(page.getByRole('cell', { name: T1, exact: true })).toHaveCount(0);

    await page.goto('/admin/trash');
    await expect(page.getByRole('cell', { name: T1, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: T2, exact: true })).toBeVisible();
  });
});
