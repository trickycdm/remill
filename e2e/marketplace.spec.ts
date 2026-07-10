import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.60' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const runId = Date.now().toString(36);

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
    // (.first() — re-runs against the persisted e2e D1 may have several packs
    // installed, each with its own badge.)
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
    const card = page.locator('article,div').filter({ hasText: 'Blog' }).first();
    await expect(page.getByText('Installed', { exact: true }).first()).toBeVisible();
    await expect(card).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on /admin/marketplace: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);

    // Installed → the card links through to the existing collection.
    await page.getByRole('link', { name: 'View collection', exact: false }).first().click();
    await page.waitForURL(/\/admin\/collections\//);
  });

  test('full flow: install the changelog pack, publish an entry, read the dated public page', async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/marketplace');

    // The e2e D1 persists across local runs: exercise the click-to-install on a
    // fresh DB (CI always is), fall through to the installed state otherwise.
    const installBtn = page.getByRole('button', { name: 'Install Changelog' });
    if (await installBtn.isVisible().catch(() => false)) {
      await installBtn.click();
      // dsRedirect lands on the new collection's schema page.
      await page.waitForURL('**/admin/collections/changelog');
    }

    // Author + publish a release entry through the generated admin form.
    const version = `0.0.0-${runId}`;
    await page.goto('/admin/c/changelog/new');
    await page.getByLabel(/^version/i).fill(version);
    await page.getByLabel(/^date/i).fill('2026-07-01T10:00');
    await page.getByLabel(/^type/i).selectOption('fixed');
    await fillMarkdown(page, /^body/i, 'Patched the flux capacitor.');
    await page.getByRole('button', { name: /Create Changelog/i }).click();
    await page.waitForURL(/\/admin\/c\/changelog\/doc_/);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();

    // The public page renders through the changelog template.
    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();
    await anonPage.goto(`/changelog/0-0-0-${runId}`);
    await expect(anonPage.getByRole('heading', { level: 1, name: version })).toBeVisible();
    await expect(anonPage.getByText('Fixed', { exact: true })).toBeVisible(); // type badge, labelled
    await expect(anonPage.locator('time[datetime^="2026-07-01"]')).toBeVisible(); // the release date
    await expect(anonPage.getByText('flux capacitor')).toBeVisible();
    // wants: {} — no reader-share affordance, no reading time.
    await expect(anonPage.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
    await expect(anonPage.getByText(/min read/)).toHaveCount(0);

    const axe = await new AxeBuilder({ page: anonPage }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on /changelog: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);

    await anon.close();
  });
});
