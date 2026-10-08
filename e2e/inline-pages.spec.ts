import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.114' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Serial retries re-run the whole group in a FRESH worker against the SAME D1
// state — unique-per-attempt names keep re-creates from colliding.
const RUN = Date.now().toString(36);
const PAGE_TITLE = `Board pack ${RUN}`;

// A whole document written for its own window: document-level CSS that would
// flatten remill's bar if it leaked, a Google Font, a script that writes into
// the page, and a Datastar-shaped attribute that must stay inert.
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Board pack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <style>
    * { margin: 0; padding: 0; }
    :root { --ink: rgb(10, 20, 30); }
    body { background: rgb(1, 2, 3); color: rgb(250, 250, 250); padding: 24px; }
  </style>
</head>
<body>
  <h1 id="inline-title">Quarterly board pack</h1>
  <p>Revenue grew 12% year on year. Costs were flat.</p>
  <p id="ran"></p>
  <button id="ds" type="button" data-on:click="el.textContent = 'datastar ran'">Untouched</button>
  <script>document.getElementById('ran').textContent = 'script ran';</script>
</body>
</html>`;

const panel = (page: Page) => page.getByRole('complementary', { name: 'Review comments' });

/** Select `text` in the inline page, as a reader would. */
async function select(page: Page, text: string): Promise<void> {
  await page.locator('.rm-page').evaluate((root, needle) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(needle);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + needle.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
    }
    throw new Error(`text not found: ${needle}`);
  }, text);
}

const highlights = (page: Page) =>
  page.evaluate(
    () => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('rm-review')?.size ?? 0,
  );

// Inline pages (D63) on the built-in Pages collection (D62): the document
// renders IN remill's page — no iframe — with its styles scoped to it, its
// scripts running, Datastar kept out, and the review overlay working on it
// directly. Private until the owner opts a page in.
test.describe.serial('Built-in Pages — inline document, comments, private by default', () => {
  let editPath: string;
  let viewPath: string;
  let publicPath: string;

  test('a pasted page opens in the viewer, rendered in place', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByLabel('Admin sections').getByRole('link', { name: 'Pages', exact: true }).click();
    await page.waitForURL('**/admin/c/pages');

    await page.goto('/admin/c/pages/new');
    await page.getByLabel(/^Title/).fill(PAGE_TITLE);
    await page.getByLabel(/^HTML/).fill(PAGE_HTML);
    await page.getByRole('button', { name: /Create /i }).click();
    await page.waitForURL(/\/admin\/c\/pages\/doc_/);
    editPath = new URL(page.url()).pathname;
    viewPath = `${editPath}/view`;
    publicPath = `/pages/${editPath.split('/').pop()}`;

    // From the list, a page opens in its viewer, not on a form of html source.
    await page.goto('/admin/c/pages');
    await page.getByRole('link', { name: PAGE_TITLE, exact: true }).click();
    await page.waitForURL(`**${viewPath}`);
    await expect(page.getByRole('heading', { level: 1, name: PAGE_TITLE })).toBeVisible();
    await expect(page.getByText('private', { exact: true })).toBeVisible();

    // In place, not framed.
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('#inline-title')).toHaveText('Quarterly board pack');
    // The page's script ran; Datastar left its attribute alone.
    await expect(page.locator('#ran')).toHaveText('script ran');
    await page.locator('#ds').click();
    await expect(page.locator('#ds')).toHaveText('Untouched');
  });

  test("the page's CSS stays on the page, and the page policy admits its resources", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.goto(viewPath);
    const csp = res!.headers()['content-security-policy'] ?? '';
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).toContain("frame-ancestors 'none'");

    const styles = await page.evaluate(() => {
      const css = (el: Element) => getComputedStyle(el);
      const header = document.querySelector('header')!;
      const wrapper = document.querySelector('.rm-page')!;
      return {
        bodyBg: css(document.body).backgroundColor,
        headerPadding: css(header).paddingLeft,
        wrapperBg: css(wrapper).backgroundColor,
        wrapperPadding: css(wrapper).paddingLeft,
        ink: css(wrapper).getPropertyValue('--ink').trim(),
      };
    });
    // `body {}` and `:root {}` landed on the wrapper…
    expect(styles.wrapperBg).toBe('rgb(1, 2, 3)');
    expect(styles.wrapperPadding).toBe('24px');
    expect(styles.ink).toBe('rgb(10, 20, 30)');
    // …and `* { padding: 0 }` / `body { background }` never reached remill's own page.
    expect(styles.bodyBg).not.toBe('rgb(1, 2, 3)');
    expect(styles.headerPadding).not.toBe('0px');
  });

  test('comments anchor to selected text in the page and survive a reload', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(viewPath);
    await page.getByRole('link', { name: 'Comments', exact: true }).click();
    await page.waitForURL(`**${viewPath}?review=1`);
    await expect(panel(page)).toBeVisible();

    await select(page, 'grew 12%');
    await expect(panel(page).locator('[data-rm-quote-preview]')).toHaveText('grew 12%');
    await panel(page).getByRole('textbox', { name: /^Comment/ }).fill('Source for this?');
    await panel(page).getByRole('button', { name: 'Add comment' }).click();
    await expect(panel(page).getByRole('status')).toHaveText('Comment added.');

    // Anchored against the stored document (its <title> did not shift the
    // match), and painted on the page itself.
    const card = panel(page).locator('article', { hasText: 'Source for this?' });
    await expect(card.locator('blockquote')).toHaveText('grew 12%');
    await expect(card.getByText('Outdated')).toHaveCount(0);
    await expect.poll(() => highlights(page)).toBe(1);

    await page.reload();
    await expect.poll(() => highlights(page)).toBe(1);
  });

  test('a private page has no public URL; made public, anyone gets the bare viewer', async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const visitor = await context.newPage();
    expect((await visitor.goto(publicPath))!.status()).toBe(404);

    await loginAsAdmin(page);
    await page.goto(editPath);
    await page.getByRole('radio', { name: /^Public/ }).check();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('radio', { name: /^Public/ })).toBeChecked();

    expect((await visitor.goto(publicPath))!.status()).toBe(200);
    await expect(visitor.getByRole('heading', { level: 1, name: PAGE_TITLE })).toBeVisible();
    await expect(visitor.locator('#inline-title')).toHaveText('Quarterly board pack');
    await expect(visitor.locator('#ran')).toHaveText('script ran');
    for (const name of ['Share', 'Versions', 'Download', 'Edit']) {
      await expect(visitor.getByRole('button', { name, exact: true })).toHaveCount(0);
      await expect(visitor.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    // The author's markup is theirs; axe covers remill's chrome around it.
    const axe = await new AxeBuilder({ page: visitor }).withTags(WCAG).exclude('.rm-page').analyze();
    expect(axe.violations, `axe on public viewer: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);
    await context.close();
  });
});
