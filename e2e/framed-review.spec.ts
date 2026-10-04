import { test, expect, type Browser, type FrameLocator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { openNewLink, linkRow } from './helpers/share';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.62' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Serial retries re-run the whole group in a FRESH worker against the SAME D1
// state — unique-per-attempt names keep re-creates from colliding.
const RUN = Date.now().toString(36);
const SLUG = `review-frame-${RUN}`;
const TITLE = `Framed report ${RUN}`;

// A whole document: head text that must NOT count as prose, a figure to
// comment on as a block, and a line only the browser ever sees.
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>Head title, not prose</title><style>body { font-family: sans-serif; }</style></head>
<body>
  <h1>Quarterly report</h1>
  <p>Revenue grew 12% year on year. Costs were flat.</p>
  <figure data-rm-anchor="revenue-chart"><svg width="80" height="40" role="img" aria-label="chart"><rect width="80" height="40"></rect></svg></figure>
  <p id="live-total"></p>
  <script>document.getElementById('live-total').textContent = 'Live total: 4.2m';</script>
</body>
</html>`;

const panel = (page: Page) => page.getByRole('complementary', { name: 'Review comments' });
const frameOf = (page: Page) => page.frameLocator('iframe[data-rm-frame]');

/** Select `text` INSIDE the framed document, as a reader would. */
async function selectInFrame(frame: FrameLocator, text: string): Promise<void> {
  await frame.locator('body').evaluate((body, needle) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
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

/** How many passages the bridge has painted inside the frame. */
const highlightsIn = (frame: FrameLocator) =>
  frame
    .locator('body')
    .evaluate(
      () =>
        (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('rm-review')
          ?.size ?? 0,
    );

async function addComment(page: Page, body: string, target?: string): Promise<void> {
  const p = panel(page);
  if (target) await p.getByLabel('Commenting on').selectOption({ label: target });
  await p.getByRole('textbox', { name: /^Comment/ }).fill(body);
  await p.getByRole('button', { name: 'Add comment' }).click();
  await expect(p.getByRole('status')).toHaveText('Comment added.');
}

async function reviewerPage(browser: Browser, url: string): Promise<Page> {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

// Review on a FRAMED page (D55 + D60): the panel lives in the viewer shell,
// the document in a sandboxed frame, and the two talk through the bridge.
test.describe.serial('Framed pages — review comments through the frame bridge', () => {
  let editUrl: string;
  let viewPath: string;
  let reviewUrl: string;

  test('setup: a frame-mode page, and a review link minted from the viewer', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/collections/new');
    await page.getByLabel(/^Name/).fill(`Review frame ${RUN}`);
    await page.getByLabel(/^Slug/).fill(SLUG);
    await page.getByLabel('Public rendering').selectOption('frame');
    await page.getByLabel('Key for field 1', { exact: true }).fill('title');
    await page.getByRole('button', { name: /Add field/i }).click();
    await page.getByLabel('Key for field 2', { exact: true }).fill('page');
    await page.getByLabel('Type for field 2', { exact: true }).selectOption('html');
    await page.getByRole('button', { name: /Create collection/i }).click();
    await page.waitForURL(new RegExp(`/admin/collections/${SLUG}$`));

    await page.goto(`/admin/c/${SLUG}/new`);
    await page.getByLabel(/^title/i).fill(TITLE);
    await page.getByLabel(/^page/i).fill(PAGE_HTML);
    await page.getByRole('button', { name: /Create /i }).click();
    await page.waitForURL(new RegExp(`/admin/c/${SLUG}/doc_`));
    editUrl = page.url();
    viewPath = `${new URL(editUrl).pathname}/view`;

    await page.goto(viewPath);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const share = page.getByRole('dialog', { name: 'Share' });
    await openNewLink(share);
    await share.getByRole('radio', { name: /^Read and comment/ }).check();
    await share.getByLabel('Reviewer name (optional)').fill('Alice');
    await share.getByRole('button', { name: 'Create link', exact: true }).click();
    reviewUrl = await linkRow(share, 'Review: Alice')
      .locator('input[id^=share-link-url-]')
      .inputValue();
    expect(reviewUrl).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
  });

  test('a reviewer selects text in the frame, comments on it and on a figure; the bridge paints them', async ({
    browser,
  }) => {
    const alice = await reviewerPage(browser, reviewUrl);
    const frame = frameOf(alice);
    await expect(alice.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(panel(alice).getByText('Reviewing as')).toContainText('Alice');
    await expect(frame.getByRole('heading', { name: 'Quarterly report' })).toBeVisible();

    // Selection inside the sandboxed frame reaches the shell's composer.
    await selectInFrame(frame, 'grew 12%');
    await expect(panel(alice).locator('[data-rm-quote-preview]')).toHaveText('grew 12%');
    await expect(panel(alice).getByLabel('Commenting on')).toHaveValue('selection');
    await expect(alice.getByRole('button', { name: 'Comment', exact: true })).toBeVisible();
    await addComment(alice, 'What is the source for this?');

    // Anchored (the server found the quote in the stored document — its
    // <title> text did not shift the match), and painted INSIDE the frame.
    const card = panel(alice).locator('article', { hasText: 'What is the source for this?' });
    await expect(card.locator('blockquote')).toHaveText('grew 12%');
    await expect(card.getByText('Outdated')).toHaveCount(0);
    await expect.poll(() => highlightsIn(frame)).toBe(1);
    // The composer reset, and the frame's selection was dropped with it.
    await expect(panel(alice).getByLabel('Commenting on')).toHaveValue('document');
    await expect
      .poll(() => frame.locator('body').evaluate(() => window.getSelection()?.isCollapsed))
      .toBe(true);

    // A figure, as a block.
    await addComment(alice, 'Label the axes', 'Figure: revenue-chart');
    await expect(frame.locator('figure[data-rm-anchor=revenue-chart]')).toHaveAttribute(
      'data-rm-commented',
      '',
    );

    // Script-generated text isn't in the server's copy: the comment still
    // lands, on the whole document, with the selection kept.
    await selectInFrame(frame, 'Live total: 4.2m');
    await expect(panel(alice).locator('[data-rm-quote-preview]')).toHaveText('Live total: 4.2m');
    await addComment(alice, 'Is this number live?');
    await expect(
      panel(alice).locator('article', { hasText: 'Is this number live?' }),
    ).toContainText('selected “Live total: 4.2m”');

    // Passage → card: clicking the highlighted text focuses its thread.
    // (A real pointer click at the painted range's position, in page coordinates.)
    const spot = await frame.locator('body').evaluate(() => {
      const [range] = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(
        'rm-review',
      )!;
      const r = range.getClientRects()[0];
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const box = (await alice.locator('iframe[data-rm-frame]').boundingBox())!;
    await alice.mouse.click(box.x + spot.x, box.y + spot.y);
    await expect(card).toBeFocused();

    // Everything survives a reload (fresh ticket, bridge re-announces itself).
    await alice.reload();
    await expect.poll(() => highlightsIn(frameOf(alice))).toBe(1);
    await expect(frameOf(alice).locator('figure[data-rm-anchor=revenue-chart]')).toHaveAttribute(
      'data-rm-commented',
      '',
    );

    const axe = await new AxeBuilder({ page: alice }).withTags(WCAG).exclude('iframe').analyze();
    expect(
      axe.violations,
      `axe on framed review: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);
    // The panel is a column beside the frame, which keeps most of the width…
    const frameBox = (await alice.locator('iframe[data-rm-frame]').boundingBox())!;
    const panelBox = (await panel(alice).boundingBox())!;
    expect(frameBox.height).toBeGreaterThan(400);
    expect(frameBox.width).toBeGreaterThan(panelBox.width);
    expect(panelBox.x).toBeGreaterThanOrEqual(frameBox.x + frameBox.width - 1);
    // …with no page-level overflow either way.
    expect(
      await alice.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight;
      }),
    ).toBe(true);
    await alice.context().close();
  });

  test('messages from the frame are untrusted: forged ones propose at most, and never post', async ({
    browser,
  }) => {
    const alice = await reviewerPage(browser, reviewUrl);
    const frame = frameOf(alice);
    await expect(frame.getByRole('heading', { name: 'Quarterly report' })).toBeVisible();
    const threads = panel(alice).locator('[data-rm-thread]');
    const before = await threads.count();
    const preview = panel(alice).locator('[data-rm-quote-preview]');
    const rect = { top: 10, left: 10, bottom: 30, right: 200 };

    // The author's scripts share the bridge's window, so they can send what it sends.
    const fromFrame = (message: unknown) =>
      frame.locator('body').evaluate((_b, m) => window.parent.postMessage(m, '*'), message);

    // Malformed, oversized, or unknown messages are dropped whole.
    await fromFrame({
      rm: 'rm-frame',
      type: 'selection',
      selection: { quote: 'x'.repeat(5000), prefix: '', suffix: '', start: 0, rect },
    });
    await fromFrame({
      rm: 'rm-frame',
      type: 'selection',
      selection: { quote: 'no rect', prefix: '', suffix: '', start: 0 },
    });
    await fromFrame({ rm: 'rm-frame', type: 'post', body: 'spam' });
    await fromFrame({ rm: 'rm-shell', type: 'paint', threads: [] });
    // …and a well-formed message from any window but the frame is ignored.
    await alice.evaluate((r) => {
      window.postMessage(
        {
          rm: 'rm-frame',
          type: 'selection',
          selection: { quote: 'from the shell itself', prefix: '', suffix: '', start: 0, rect: r },
        },
        '*',
      );
    }, rect);
    await alice.waitForFunction(
      () => new Promise((done) => requestAnimationFrame(() => done(true))),
    );
    await expect(preview).toBeHidden();

    // A well-formed forgery carrying markup is only ever a PROPOSAL, shown as text.
    const forged = '<img src=x onerror="document.title=\'pwned\'">';
    await fromFrame({
      rm: 'rm-frame',
      type: 'selection',
      selection: { quote: forged, prefix: '', suffix: '', start: 0, rect },
    });
    await expect(preview).toHaveText(forged);
    await expect(preview.locator('img')).toHaveCount(0);
    expect(await alice.title()).not.toBe('pwned');
    // Nothing was posted on the reader's behalf.
    await expect(threads).toHaveCount(before);
    await alice.context().close();
  });

  test('the owner reviews in the viewer: sees the threads, replies, resolves; anchors follow an edit', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(viewPath);
    // Comments are opt-in on the owner's view (the frame keeps the full width).
    await expect(panel(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Comments', exact: true }).click();
    await page.waitForURL(`**${viewPath}?review=1`);
    const card = panel(page).locator('article', { hasText: 'What is the source for this?' });
    await expect(card).toBeVisible();
    await expect.poll(() => highlightsIn(frameOf(page))).toBe(1);

    await card.getByText('Reply', { exact: true }).click();
    await card.getByRole('textbox', { name: /^Reply/ }).fill('Finance pack, page 4.');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(card.getByText('Finance pack, page 4.')).toBeVisible();

    // Edit the page ABOVE the quote: the thread re-anchors and stays painted.
    await page.goto(editUrl);
    await page
      .getByLabel(/^page/i)
      .fill(
        PAGE_HTML.replace(
          '<h1>Quarterly report</h1>',
          '<h1>Quarterly report</h1><p>A new opening paragraph.</p>',
        ),
      );
    await page.getByLabel('Document actions').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('#2', { exact: false }).first()).toBeVisible();
    await page.goto(`${viewPath}?review=1`);
    await expect(frameOf(page).getByText('A new opening paragraph.')).toBeVisible();
    await expect(
      panel(page)
        .locator('article', { hasText: 'What is the source for this?' })
        .getByText('Outdated'),
    ).toHaveCount(0);
    await expect.poll(() => highlightsIn(frameOf(page))).toBe(1);

    // Resolve: the passage is no longer painted.
    await panel(page)
      .locator('article', { hasText: 'What is the source for this?' })
      .getByRole('button', { name: 'Resolve', exact: true })
      .click();
    await expect.poll(() => highlightsIn(frameOf(page))).toBe(0);

    // A past version is read-only history: no comments there.
    await page.goto(`${viewPath}?rev=1&review=1`);
    await expect(page.getByRole('status').filter({ hasText: 'Version 1 of 2' })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });
});
