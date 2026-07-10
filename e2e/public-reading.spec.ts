import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.44' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// The `articles` collection (templated 'article', publicRead) + a hero media row
// are seeded by scripts/seed-e2e.ts. Serial: the reading test reads the article
// the setup test publishes.
const runId = Date.now().toString(36);
const TITLE = `Reading experience ${runId}`;
const EXCERPT = 'A short standfirst that sits under the title, not in a labelled row.';
const BODY = 'Some body prose with a handful of words so a reading estimate resolves.';

test.describe.serial('Public reading experience — the article template', () => {
  test('setup: publish an article with a hero, dek, and tags', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/articles/new');
    await page.getByLabel(/^title/i).fill(TITLE);
    await page.getByLabel(/^excerpt/i).fill(EXCERPT);
    await page.getByLabel(/^hero/i).fill('med_e2ehero00000000');
    await page.getByLabel(/^tags/i).fill('alpha, beta');
    await fillMarkdown(page, /^body/i, BODY);
    await page.getByRole('button', { name: /Create Articles/i }).click();
    await page.waitForURL(/\/admin\/c\/articles\/doc_/);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();
  });

  test('reads as an editorial page: hero-first with alt, dek standfirst, reading time, no slug row', async ({
    browser,
  }) => {
    // Manual contexts don't inherit the config `use`; re-state reducedMotion so
    // axe reads resting colors.
    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();

    // Reach the article via the homepage writing index (no need to know the slug).
    await anonPage.goto('/');
    await anonPage.getByRole('link', { name: TITLE }).click();
    await expect(anonPage).toHaveURL(/\/articles\//);

    // Hero renders at the top with the real alt from the media record (Phase 1).
    const hero = anonPage.locator('figure img');
    await expect(hero).toHaveAttribute('alt', 'E2E hero image');

    // One H1 (the title); the excerpt is a standfirst, not a labelled "Excerpt" row.
    await expect(anonPage.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(anonPage.locator('.rm-standfirst')).toContainText(EXCERPT);
    await expect(anonPage.getByText('Excerpt', { exact: true })).toHaveCount(0);

    // The slug is never shown as reader content.
    await expect(anonPage.getByText('Slug', { exact: true })).toHaveCount(0);

    // ...and never leaks into the share-preview surface either: the meta/og
    // description must start with real prose, not the slug (regression: the
    // search-text body used to lead with the slug field's value).
    const metaDescription = await anonPage
      .locator('meta[name="description"]')
      .getAttribute('content');
    expect(metaDescription).toBeTruthy();
    expect(metaDescription!.startsWith(EXCERPT.slice(0, 20))).toBe(true);
    expect(metaDescription).not.toMatch(/^[a-z0-9-]+ /); // no leading slug token
    const ogDescription = await anonPage
      .locator('meta[property="og:description"]')
      .getAttribute('content');
    expect(ogDescription).toBe(metaDescription);

    // Reading time + a published date.
    await expect(anonPage.getByText(/\d+ min read/)).toBeVisible();
    await expect(anonPage.locator('time')).toBeVisible();

    // The masthead links home.
    await expect(anonPage.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');

    // Reader share: the island reveals a "Copy link" button (proves it mounts).
    await expect(anonPage.getByRole('button', { name: 'Copy link' })).toBeVisible();

    const axe = await new AxeBuilder({ page: anonPage }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on /articles: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);

    await anon.close();
  });
});
