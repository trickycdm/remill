import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.26' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Serial: later tests read the collection/doc the first one makes. Unique run
// suffix on TITLES only — the collection slug must be stable for URL asserts,
// and re-runs against the same D1 tolerate an existing collection.
const runId = Date.now().toString(36);
const PUB = `Launch post ${runId}`;
const DRAFT = `Secret draft ${runId}`;

test.describe.serial('D35/D36 — public discovery (feeds, sitemap, OG, homepage)', () => {
  test('setup: a publicRead collection with one published and one draft doc', async ({ page }) => {
    await loginAsAdmin(page);

    // Create the collection only if a prior run didn't already.
    const existing = await page.goto('/admin/collections/stories');
    if (existing?.status() !== 200 || !(await page.getByRole('heading', { name: /stories/i }).count())) {
      await page.goto('/admin/collections/new');
      await page.getByLabel(/^Name/).fill('Stories');
      await page.getByLabel(/^Slug/).fill('stories');
      await page.getByLabel('Lifecycle').selectOption('draft');
      await page.getByLabel('Public read access').check();
      await page.getByLabel('Key for field 1', { exact: true }).fill('title');
      await page.getByLabel('Required for field 1', { exact: true }).check();
      await page.getByLabel('Indexed for field 1', { exact: true }).check();
      await page.getByRole('button', { name: /Add field/i }).click();
      await page.getByLabel('Key for field 2', { exact: true }).fill('slug');
      await page.getByLabel('Type for field 2', { exact: true }).selectOption('slug');
      await page.getByLabel('Indexed for field 2', { exact: true }).check();
      await page.getByRole('button', { name: /Add field/i }).click();
      await page.getByLabel('Key for field 3', { exact: true }).fill('body');
      await page.getByLabel('Type for field 3', { exact: true }).selectOption('markdown');
      await page.getByRole('button', { name: /Create collection/i }).click();
      await page.waitForURL(/\/admin\/collections\/stories$/);
    }

    // One published… (slug filled explicitly — builder-created slug fields
    // carry no `from` config, so nothing auto-derives)
    await page.goto('/admin/c/stories/new');
    await page.getByLabel(/^title/i).fill(PUB);
    await page.getByLabel(/^slug/i).fill(`launch-post-${runId}`);
    await fillMarkdown(page, /^body/i, 'The launch is **now** — read all about it.');
    await page.getByRole('button', { name: /Create Stories/i }).click();
    await page.waitForURL(/\/admin\/c\/stories\/doc_/);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();

    // …and one that stays a draft.
    await page.goto('/admin/c/stories/new');
    await page.getByLabel(/^title/i).fill(DRAFT);
    await fillMarkdown(page, /^body/i, 'Not for anyone.');
    await page.getByRole('button', { name: /Create Stories/i }).click();
    await page.waitForURL(/\/admin\/c\/stories\/doc_/);
  });

  test('rss.xml serves the published doc, never the draft; ?collection narrows', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    const res = await anonPage.request.get('/rss.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/rss+xml');
    const xml = await res.text();
    expect(xml).toContain(PUB);
    expect(xml).not.toContain(DRAFT);

    const narrowed = await anonPage.request.get('/rss.xml?collection=stories');
    expect(narrowed.status()).toBe(200);
    expect(await narrowed.text()).toContain(PUB);
    const ghost = await anonPage.request.get('/rss.xml?collection=no-such');
    expect(ghost.status()).toBe(404);

    await anon.close();
  });

  test('sitemap.xml lists the published URL; robots.txt shields protected surfaces', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    const sitemap = await (await anonPage.request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('<urlset');
    expect(sitemap).toContain(`/stories/launch-post-${runId}`);

    const robots = await (await anonPage.request.get('/robots.txt')).text();
    for (const path of ['/admin', '/api', '/mcp', '/auth', '/s/']) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);

    await anon.close();
  });

  test('homepage renders published docs for anonymous, never drafts; axe-clean', async ({ browser }) => {
    // Manual contexts don't inherit the config's `use` options — re-state
    // reducedMotion so axe reads resting colors, not mid-entrance frames.
    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();

    await anonPage.goto('/');
    await expect(anonPage.getByRole('heading', { name: 'Stories' })).toBeVisible();
    await expect(anonPage.getByRole('link', { name: PUB })).toBeVisible();
    await expect(anonPage.getByText(DRAFT)).toHaveCount(0);

    const axe = await new AxeBuilder({ page: anonPage }).withTags(WCAG).analyze();
    expect(axe.violations, `axe on /: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    await anon.close();
  });

  test('homepage marketing chrome: one h1, working CTAs, quickstart; axe-clean in dark', async ({ browser }) => {
    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();

    await anonPage.goto('/');

    // Exactly one h1 (the hero); the writing index is demoted below it.
    await expect(anonPage.getByRole('heading', { level: 1 })).toHaveCount(1);

    // Primary CTA anchors to the agent quickstart, which shows the MCP endpoint.
    const cta = anonPage.getByRole('link', { name: 'Connect an agent' });
    await expect(cta).toHaveAttribute('href', '#connect');
    await cta.click();
    await expect(anonPage.getByRole('heading', { name: 'Connect an agent' })).toBeInViewport();
    await expect(anonPage.locator('#connect')).toContainText('/mcp');

    // Secondary CTA anchors to the published writing index.
    await expect(anonPage.getByRole('link', { name: 'Browse the writing' })).toHaveAttribute(
      'href',
      '#writing',
    );
    await expect(anonPage.locator('#writing')).toBeVisible();

    // The light-dark() token pairings must stay AA in the dark theme too.
    await anonPage.emulateMedia({ colorScheme: 'dark' });
    const axe = await new AxeBuilder({ page: anonPage }).withTags(WCAG).analyze();
    expect(axe.violations, `axe on / (dark): ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    await anon.close();
  });

  test('the public doc page carries composed title, canonical, and OG meta', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    await anonPage.goto('/');
    await anonPage.getByRole('link', { name: PUB }).click();
    await expect(anonPage.getByRole('heading', { name: PUB })).toBeVisible();

    await expect(anonPage).toHaveTitle(new RegExp(`^${PUB} — `));
    const canonical = anonPage.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', /\/stories\/launch-post/);
    const ogTitle = anonPage.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute('content', new RegExp(`^${PUB} — `));
    const ogType = anonPage.locator('meta[property="og:type"]');
    await expect(ogType).toHaveAttribute('content', 'article');
    const feed = anonPage.locator('link[rel="alternate"][type="application/rss+xml"]');
    await expect(feed).toHaveAttribute('href', '/rss.xml');

    await anon.close();
  });
});
