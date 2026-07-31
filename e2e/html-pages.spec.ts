import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately from the others.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.88' } });

// Serial retries re-run the whole group in a FRESH worker against the SAME D1
// state — unique-per-attempt names keep re-creates from colliding.
const RUN = Date.now().toString(36);
const SLUG = `pages-${RUN}`;

const PAGE_HTML = `<!doctype html>
<html>
<head><title>Q3 metrics</title></head>
<body>
  <h1 id="raw-title">Quarterly metrics</h1>
  <canvas id="chart" width="400" height="200"></canvas>
  <script src="/vendor/chart.umd.js"></script>
  <script>
    new window.Chart(document.getElementById('chart'), {
      type: 'bar',
      data: { labels: ['A', 'B'], datasets: [{ label: 'demo', data: [3, 7] }] },
    });
  </script>
</body>
</html>`;

// HTML pages (D25/D27) end to end: a raw-mode collection built in the admin,
// a document whose html field IS the page, served full-bleed to an anonymous
// visitor with the VENDORED Chart.js executing under the strict CSP; then the
// CDN toggle widens the public policy only.
test.describe.serial('HTML pages — raw renderMode, vendored charts, CSP toggle', () => {
  let pageUrl: string;

  test('admin builds a raw-mode public collection with an html field and publishes a chart page', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/admin/collections/new');
    await page.getByLabel(/^Name/).fill('Pages');
    await page.getByLabel(/^Slug/).fill(SLUG);
    await page.getByLabel('Visibility').selectOption('public');
    await page.getByLabel('Public rendering').selectOption('raw');
    await page.getByLabel('Key for field 1', { exact: true }).fill('title');
    await page.getByLabel('Indexed for field 1', { exact: true }).check();
    await page.getByRole('button', { name: /Add field/i }).click();
    await page.getByLabel('Key for field 2', { exact: true }).fill('page');
    await page.getByLabel('Type for field 2', { exact: true }).selectOption('html');
    await page.getByRole('button', { name: /Create collection/i }).click();
    await page.waitForURL(new RegExp(`/admin/collections/${SLUG}$`));

    await page.goto(`/admin/c/${SLUG}/new`);
    await page.getByLabel(/^title/i).fill('Q3 metrics');
    await page.getByLabel(/^page/i).fill(PAGE_HTML);
    await page.getByRole('button', { name: /Create /i }).click();
    await page.waitForURL(new RegExp(`/admin/c/${SLUG}/doc_`));
    const id = page.url().match(/(doc_[A-Za-z0-9_-]+)/)?.[1];
    expect(id).toBeTruthy();

    // Publish-immediately lifecycle → the doc is born published.
    pageUrl = `/${SLUG}/${id}`;
  });

  test('an anonymous visitor gets the FULL-BLEED page and the vendored chart executes', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(pageUrl);

    // Raw mode: the author's document, not the branded shell (no masthead
    // header, no #main-content shell landmark).
    await expect(page.locator('#raw-title')).toHaveText('Quarterly metrics');
    await expect(page.locator('#main-content')).toHaveCount(0);
    await expect(page.locator('header')).toHaveCount(0);

    // The vendored Chart.js loaded same-origin and RAN under the strict CSP.
    await page.waitForFunction(() => typeof (window as { Chart?: unknown }).Chart === 'function');
    await expect(page.locator('canvas#chart')).toBeVisible();
    await context.close();
  });

  test('the CDN toggle widens the PUBLIC CSP only (admin stays strict)', async ({ page }) => {
    const cspOf = async (path: string) =>
      (await page.request.get(path)).headers()['content-security-policy'] ?? '';

    // Toggle off: strict everywhere.
    expect(await cspOf(pageUrl)).not.toContain('cdn.jsdelivr.net');

    // Flip the setting through the real settings form (dsRedirect back on save).
    await loginAsAdmin(page);
    await page.goto('/admin/settings');
    // siteName is required — make sure it's set whether or not the singleton exists yet.
    const siteName = page.getByLabel(/^Site name/);
    if (!(await siteName.inputValue())) await siteName.fill('remill e2e');
    await page.getByLabel(/Allow CDN scripts/i).check();
    await page.getByRole('button', { name: /Save settings/i }).click();
    await page.waitForURL('**/admin/settings');
    await expect(page.getByLabel(/Allow CDN scripts/i)).toBeChecked();

    // Public pages now allow the two whitelisted hosts; admin never does.
    const publicCsp = await cspOf(pageUrl);
    expect(publicCsp).toContain('https://cdn.jsdelivr.net');
    expect(publicCsp).toContain('https://unpkg.com');
    expect(await cspOf('/admin/login')).not.toContain('cdn.jsdelivr.net');
  });
});
