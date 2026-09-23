import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.91' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Document visibility (D50: public/unlisted/private) + password-protected share
// links (D51) on the `articles` collection (templated, publicRead) seeded by
// scripts/seed-e2e.ts. Serial: later tests act on the doc the setup test
// publishes, and the share-link test reads the link the create-link test mints.
const runId = Date.now().toString(36);
const TITLE = `Visibility flow ${runId}`;
const EXCERPT = 'A standfirst for the visibility and share-link e2e coverage.';
const BODY = 'Body prose for the visibility and share-link flow.';
const PASSWORD = 'correct-horse-9';

let docId = '';
let slugUrl = '';
let docUrl = '';
let editUrl = '';
let shareLinkUrl = '';

test.describe.serial('Document visibility + share links', () => {
  test('setup: publish an article and read its slug + doc_ URLs', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/articles/new');
    await page.getByLabel(/^title/i).fill(TITLE);
    await page.getByLabel(/^excerpt/i).fill(EXCERPT);
    await fillMarkdown(page, /^body/i, BODY);
    await page.getByRole('button', { name: /Create Articles/i }).click();
    await page.waitForURL(/\/admin\/c\/articles\/doc_/);
    editUrl = page.url();
    docId = editUrl.split('/').pop()!;
    docUrl = `/articles/${docId}`;

    const slugValue = await page.getByLabel(/^slug/i).inputValue();
    slugUrl = `/articles/${slugValue}`;

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();
  });

  test('unlisted: slug URL 404s, doc_ URL renders noindex + OG meta, absent from index and RSS', async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);
    await page.getByRole('radio', { name: /^Unlisted/ }).check();
    await page.getByRole('button', { name: 'Update visibility' }).click();
    await page.waitForURL(editUrl);
    await expect(page.getByRole('radio', { name: /^Unlisted/ })).toBeChecked();

    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();

    const slugRes = await anonPage.goto(slugUrl);
    expect(slugRes?.status()).toBe(404);

    const docRes = await anonPage.goto(docUrl);
    expect(docRes?.status()).toBe(200);
    await expect(anonPage.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(anonPage.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(anonPage.locator('meta[property="og:description"]')).toHaveCount(1);
    await expect(anonPage.locator('meta[property="og:site_name"]')).toHaveCount(1);

    const indexRes = await anonPage.goto('/articles');
    expect(indexRes?.status()).toBe(200);
    await expect(anonPage.getByRole('link', { name: TITLE })).toHaveCount(0);

    const rss = await anonPage.request.get('/rss.xml');
    expect(rss.ok()).toBe(true);
    const rssBody = await rss.text();
    expect(rssBody).not.toContain(TITLE);

    await anon.close();
  });

  test('private: doc_ URL 404s for anonymous', async ({ page, browser }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);
    await page.getByRole('radio', { name: /^Private/ }).check();
    await page.getByRole('button', { name: 'Update visibility' }).click();
    await page.waitForURL(editUrl);
    await expect(page.getByRole('radio', { name: /^Private/ })).toBeChecked();

    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();
    const res = await anonPage.goto(docUrl);
    expect(res?.status()).toBe(404);
    await anon.close();
  });

  test('create a password-protected share link', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);

    await page.getByLabel('Label (optional)').fill(`Review copy ${runId}`);
    await page.getByLabel('Password (optional)').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create share link' }).click();

    await expect(page.getByRole('heading', { name: 'Share link created' })).toBeVisible();
    shareLinkUrl = await page.getByLabel('Share link URL').inputValue();
    expect(shareLinkUrl).toMatch(/\/s\/[^/]+$/);
  });

  test('anonymous: the link is protected, no title/OG leak, axe clean, then unlocks with the right password', async ({
    browser,
  }) => {
    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();

    const path = new URL(shareLinkUrl).pathname;
    const res = await anonPage.goto(path);
    expect(res?.status()).toBe(200);
    await expect(anonPage.getByRole('heading', { name: 'This link is protected' })).toBeVisible();
    await expect(anonPage.getByText(TITLE)).toHaveCount(0);
    await expect(anonPage.locator('meta[property^="og:"]')).toHaveCount(0);

    const axe = await new AxeBuilder({ page: anonPage }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on locked share link: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);

    await anonPage.getByLabel('Password').fill('not-the-password');
    await anonPage.getByRole('button', { name: 'Unlock' }).click();
    await expect(anonPage.getByRole('alert')).toContainText("That password didn't work.");
    await expect(anonPage.getByText(TITLE)).toHaveCount(0);

    await anonPage.getByLabel('Password').fill(PASSWORD);
    await anonPage.getByRole('button', { name: 'Unlock' }).click();
    await expect(anonPage.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();

    await anon.close();
  });
});
