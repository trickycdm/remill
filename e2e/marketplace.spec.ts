import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.60' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// The e2e DB seeds the `articles` collection (scripts/seed-e2e.ts), so the blog
// pack reads as INSTALLED here — this spec covers the marketplace surface and
// the installed state; the click-to-install flow is exercised by the packs that
// ship uninstalled (see the changelog/portfolio/docs specs).
test.describe('Marketplace — the content-pack surface (D42)', () => {
  test('lists the pack registry with installed state; nav item present; axe-clean', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Reachable from the sidebar nav.
    await page.getByRole('link', { name: 'Marketplace' }).click();
    await page.waitForURL('**/admin/marketplace');

    // The blog pack card: name, template, target collection, installed badge.
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
    const card = page.locator('article,div').filter({ hasText: 'Blog' }).first();
    await expect(page.getByText('Installed', { exact: true })).toBeVisible();
    await expect(card).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on /admin/marketplace: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);

    // Installed → the card links through to the existing collection.
    await page.getByRole('link', { name: 'View collection' }).click();
    await page.waitForURL('**/admin/collections/articles');
    await expect(page.getByRole('heading', { name: /articles/i }).first()).toBeVisible();
  });
});
