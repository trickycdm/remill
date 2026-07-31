import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.30' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Per-attempt unique title: serial-group retries re-run against the SAME D1.
const runId = Date.now().toString(36);
const TITLE = `Diffable ${runId}`;

test.describe('Phase 10 — revision diff viewer', () => {
  test('edit twice, Compare shows the changed line marked; axe-clean', async ({ page }) => {
    await loginAsAdmin(page);

    // Revision 1.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(TITLE);
    await fillMarkdown(page, /^body/i, 'Shared first line.\nThe original second line.');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    // No Compare link with a single revision.
    await expect(page.getByRole('link', { name: 'Compare' })).toHaveCount(0);

    // Revision 2: change only the second line.
    await fillMarkdown(page, /^body/i, 'Shared first line.\nA rewritten second line.');
    await page.getByRole('button', { name: /Save changes/i }).click();
    await expect(page.getByText('#2', { exact: false })).toBeVisible();

    // Compare (defaults: previous → latest) marks exactly the changed line.
    await page.getByRole('link', { name: 'Compare' }).click();
    await expect(page).toHaveURL(/\/revisions/);
    await expect(page.getByRole('heading', { name: 'Compare revisions' })).toBeVisible();
    await expect(page.locator('del')).toContainText('The original second line.');
    await expect(page.locator('ins')).toContainText('A rewritten second line.');
    // The shared line renders unmarked (as context, not ins/del).
    await expect(page.locator('del')).not.toContainText('Shared first line.');

    // Unchanged fields (title) get no card at all.
    await expect(page.getByRole('heading', { name: 'Title', exact: true })).toHaveCount(0);

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations, `axe on compare: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    // Explicit from/to selection round-trips through the GET form.
    await page.getByLabel('Compare from revision').selectOption({ index: 0 }); // newest
    await page.getByLabel('Compare to revision').selectOption({ index: 0 });
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByText('No differences')).toBeVisible();
  });
});
