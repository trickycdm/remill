import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { openShare, openNewLink } from './helpers/share';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.61' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Serial retries re-run the whole group in a FRESH worker against the SAME D1
// state — unique-per-attempt names keep re-creates from colliding.
const RUN = Date.now().toString(36);
const SLUG = `framed-${RUN}`;
const TITLE = `Framed metrics ${RUN}`;

// An author document that draws a vendored chart and then PROBES the sandbox:
// each thing a framed page must not be able to do is attempted and the
// outcome written into #probe for the test to read.
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>Framed metrics</title></head>
<body>
  <h1 id="framed-title">Quarterly metrics</h1>
  <canvas id="chart" width="400" height="200"></canvas>
  <p><a id="out" href="https://example.com/">An outbound link</a></p>
  <pre id="probe"></pre>
  <script src="/vendor/chart.umd.js"></script>
  <script>
    new window.Chart(document.getElementById('chart'), {
      type: 'bar',
      data: { labels: ['A', 'B'], datasets: [{ label: 'demo', data: [3, 7] }] },
    });
    var out = { chart: typeof window.Chart };
    try { out.cookie = 'open:' + document.cookie; } catch (e) { out.cookie = 'blocked'; }
    try { localStorage.setItem('k', 'v'); out.storage = 'open'; } catch (e) { out.storage = 'blocked'; }
    try { out.parent = 'open:' + window.parent.document.title; } catch (e) { out.parent = 'blocked'; }
    fetch('/api/collections')
      .then(function () { out.fetch = 'open'; }, function () { out.fetch = 'blocked'; })
      .then(function () { document.getElementById('probe').textContent = JSON.stringify(out); });
  </script>
</body>
</html>`;

const SANDBOXED = { chart: 'function', cookie: 'blocked', storage: 'blocked', parent: 'blocked', fetch: 'blocked' };

async function probeOf(scope: { locator: Page['locator'] }): Promise<unknown> {
  const probe = scope.locator('#probe');
  await expect(probe).not.toBeEmpty();
  return JSON.parse((await probe.textContent()) ?? '{}');
}

// Framed pages (D60) end to end: a frame-mode collection built in the admin, a
// document shown inside the viewer shell's sandboxed iframe — on the admin
// view and through a share link — with the author's scripts running but cut
// off from remill's origin.
test.describe.serial('Framed pages — viewer shell, sandboxed document, share link', () => {
  let editUrl: string;
  let shareUrl: string;

  test('admin builds a frame-mode collection and creates a page', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/admin/collections/new');
    await page.getByLabel(/^Name/).fill(`Framed ${RUN}`);
    await page.getByLabel(/^Slug/).fill(SLUG);
    await page.getByLabel('Public rendering').selectOption('frame');
    await page.getByLabel('Key for field 1', { exact: true }).fill('title');
    await page.getByRole('button', { name: /Add field/i }).click();
    await page.getByLabel('Key for field 2', { exact: true }).fill('page');
    await page.getByLabel('Type for field 2', { exact: true }).selectOption('html');
    await page.getByRole('button', { name: /Create collection/i }).click();
    await page.waitForURL(new RegExp(`/admin/collections/${SLUG}$`));
    // The mode round-trips through the builder (a re-save must not reset it).
    await expect(page.getByLabel('Public rendering')).toHaveValue('frame');

    await page.goto(`/admin/c/${SLUG}/new`);
    await page.getByLabel(/^title/i).fill(TITLE);
    await page.getByLabel(/^page/i).fill(PAGE_HTML);
    await page.getByRole('button', { name: /Create /i }).click();
    await page.waitForURL(new RegExp(`/admin/c/${SLUG}/doc_`));
    editUrl = page.url();
  });

  test('the admin view is the viewer shell: the page runs in a sandboxed frame, cut off from remill', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${editUrl}/view`);

    // The shell: one h1 (the title), a way back to the editor, no admin chrome
    // around the document.
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', new URL(editUrl).pathname);
    await expect(page.getByLabel('Admin sections')).toHaveCount(0);

    const iframe = page.locator('iframe');
    await expect(iframe).toHaveAttribute('title', TITLE);
    const sandbox = (await iframe.getAttribute('sandbox')) ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');

    // The author's document renders and its vendored chart script ran — but
    // every reach back towards remill's origin was refused.
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#framed-title')).toHaveText('Quarterly metrics');
    await expect(frame.locator('canvas#chart')).toBeVisible();
    expect(await probeOf(frame)).toEqual(SANDBOXED);

    // Outbound links leave in a new tab rather than replacing the framed page.
    await frame.locator('#out').dispatchEvent('click');
    await expect(frame.locator('#out')).toHaveAttribute('target', '_blank');

    // The author's html is NOT inlined into the admin DOM.
    await expect(page.locator('#framed-title')).toHaveCount(0);

    // The shell itself is accessible (the author's document is theirs to own).
    const axe = await new AxeBuilder({ page }).withTags(WCAG).exclude('iframe').analyze();
    expect(axe.violations, `axe on viewer: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);
    // No horizontal overflow from the shell.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('opening the frame URL directly is still sandboxed, cookieless and uncacheable', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${editUrl}/view`);
    const src = (await page.locator('iframe').getAttribute('src'))!;
    expect(src).toMatch(/^\/frame\/v1\./);

    const response = (await page.goto(src))!;
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(headers['x-frame-options']).toBeUndefined();
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['set-cookie']).toBeUndefined();
    // Top-level, with the admin session cookie in the jar — the CSP sandbox
    // directive still puts the document in an opaque origin. (`parent` is the
    // document itself here: there is no shell around it to reach.)
    expect(await probeOf(page)).toEqual({ ...SANDBOXED, parent: 'open:Framed metrics' });

    // A tampered ticket is the same 404 as any other refusal.
    const forged = await page.goto(src.replace(/\.[0-9a-f]+$/, `.${'0'.repeat(64)}`));
    expect(forged!.status()).toBe(404);
    await expect(page.locator('#framed-title')).toHaveCount(0);
  });

  test('a share link shows the same viewer to an anonymous reader — until it is revoked', async ({ page, browser }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);
    const share = await openShare(page);
    const rows = share.locator('li[data-share-link]');
    await openNewLink(share);
    await share.getByRole('button', { name: 'Create link', exact: true }).click();
    await expect(rows).toHaveCount(1);
    shareUrl = await rows.first().locator('input[id^=share-link-url-]').inputValue();

    const context = await browser.newContext({
      reducedMotion: 'reduce',
      extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.61' },
    });
    const reader = await context.newPage();
    await reader.goto(shareUrl);
    await expect(reader.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    // A reader gets no owner actions.
    await expect(reader.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
    const frame = reader.frameLocator('iframe');
    await expect(frame.locator('#framed-title')).toHaveText('Quarterly metrics');
    expect(await probeOf(frame)).toEqual(SANDBOXED);
    const liveSrc = (await reader.locator('iframe').getAttribute('src'))!;

    // Revoke: the still-unexpired ticket the reader already holds stops working.
    await rows.first().locator('summary').first().click();
    await rows.first().getByRole('button', { name: /Revoke/ }).click();
    await expect(rows).toHaveCount(0);
    expect((await reader.goto(liveSrc))!.status()).toBe(404);
    expect((await reader.goto(shareUrl))!.status()).toBe(404);
    await context.close();
  });
});
