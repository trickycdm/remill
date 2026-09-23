import { test, expect, type Page, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.93' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Document review (D55) end to end on the seeded `reports` collection (html +
// markdown fields; scripts/seed-e2e.ts). Serial: later tests act on the links
// and comments earlier ones create. Unique per run — serial retries re-run the
// group against the same D1.
const RUN = Date.now().toString(36);
const TITLE = `Q3 review ${RUN}`;
const PAGE_HTML =
  '<h2>Quarter three</h2><p>Revenue grew 12% in Q3 on the back of renewals.</p>' +
  '<figure data-rm-anchor="revenue-chart"><canvas width="200" height="80"></canvas><figcaption>Revenue by month</figcaption></figure>' +
  '<p id="live-total"></p><script>document.getElementById("live-total").textContent = "Live total: 4.2m";</script>';

let docId = '';
let editUrl = '';
const links: Record<'alice' | 'carol' | 'open', string> = { alice: '', carol: '', open: '' };

/** Select `text` inside the document's annotatable page field, as a reader would. */
async function selectText(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const region = document.querySelector('[data-rm-field="page"]')!;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
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

async function reviewerPage(browser: Browser, url: string): Promise<Page> {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Review comments' });

async function addComment(page: Page, body: string, opts: { target?: string; intent?: string } = {}) {
  const p = panel(page);
  if (opts.target) await p.getByLabel('Commenting on').selectOption({ label: opts.target });
  await p.getByRole('textbox', { name: /^Comment/ }).fill(body);
  if (opts.intent) await p.getByLabel('Type').selectOption({ label: opts.intent });
  await p.getByRole('button', { name: 'Add comment' }).click();
  await expect(p.getByRole('status')).toHaveText('Comment added.');
}

/** Save the edit form and wait for the save round-trip AND the reload it
 *  triggers (Datastar redirects back to the same URL, so waitForURL alone
 *  resolves before anything happened). */
async function saveAndSettle(page: Page): Promise<void> {
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(new URL(editUrl).pathname));
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: /Save changes/i }).click();
  await saved;
  await reloaded;
}

async function linkUrl(page: Page, label: string): Promise<string> {
  const card = page.locator('div.rounded-md', { hasText: label }).filter({ has: page.locator('input[id^=review-link-url-]') });
  return card.locator('input[id^=review-link-url-]').first().inputValue();
}

test.describe.serial('Document review — review links, anchored comments, the owner overlay (D55)', () => {
  test('setup: create a report and three review links (two personal, one open)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/reports/new');
    await page.getByLabel(/^title/i).fill(TITLE);
    await page.getByLabel(/^page/i).fill(PAGE_HTML);
    await page.getByRole('button', { name: /Create Reports/i }).click();
    await page.waitForURL(/\/admin\/c\/reports\/doc_/);
    editUrl = page.url();
    docId = editUrl.split('/').pop()!;

    const create = async (name: string, mode: 'group' | 'individual') => {
      await page.getByText('New review link').click();
      await page.getByLabel('Reviewer name (optional)').fill(name);
      await page.getByLabel('Reviewers see').selectOption(mode);
      await page.getByRole('button', { name: 'Create review link' }).click();
      await page.waitForURL(editUrl);
    };
    await create('Alice', 'group');
    await create('Carol', 'individual');
    await create('', 'group');

    links.alice = await linkUrl(page, 'Review: Alice');
    links.carol = await linkUrl(page, 'Review: Carol');
    links.open = await linkUrl(page, 'Open review link');
    for (const url of Object.values(links)) expect(url).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
  });

  test('a personal-link reviewer comments on selected text and on a figure; highlights paint', async ({ browser }) => {
    const alice = await reviewerPage(browser, links.alice);
    await expect(panel(alice).getByText('Reviewing as')).toContainText('Alice');
    // Signposting: the invite banner above the article and the panel's how-to.
    await expect(alice.getByRole('note')).toContainText("You've been asked to review this.");
    await expect(panel(alice).getByText('Select any text in the page to comment on it')).toBeVisible();
    await expect(panel(alice).getByText('Other reviewers on group links can see your comments.')).toBeVisible();

    await selectText(alice, 'grew 12%');
    await expect(panel(alice).locator('[data-rm-quote-preview]')).toHaveText('grew 12%');
    await expect(panel(alice).getByLabel('Commenting on')).toHaveValue('selection');
    await addComment(alice, 'What is the source for this?', { intent: 'Must fix' });

    const card = panel(alice).locator('article', { hasText: 'What is the source for this?' });
    await expect(card.locator('blockquote')).toHaveText('grew 12%');
    await expect(card.getByText('Must fix')).toBeVisible();
    await expect
      .poll(() => alice.evaluate(() => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('rm-review')?.size ?? 0))
      .toBe(1);

    // A posted comment resets the composer (no stale target or quote carried over).
    await expect(panel(alice).getByLabel('Commenting on')).toHaveValue('document');
    await expect(panel(alice).locator('[data-rm-quote-preview]')).toBeHidden();
    await addComment(alice, 'Label the axes', { target: 'Figure: revenue-chart' });
    await expect(panel(alice).locator('article', { hasText: 'Label the axes' })).toContainText('On figure');
    await expect(alice.locator('figure[data-rm-anchor=revenue-chart]')).toHaveAttribute('data-rm-commented', '');

    // Script-generated text isn't in the server's copy of the page: the
    // comment still lands, anchored to the whole document with the selection kept.
    await selectText(alice, 'Live total: 4.2m');
    await expect(panel(alice).locator('[data-rm-quote-preview]')).toHaveText('Live total: 4.2m');
    await addComment(alice, 'Is this number live?');
    await expect(panel(alice).locator('article', { hasText: 'Is this number live?' })).toContainText(
      'selected “Live total: 4.2m”',
    );

    const axe = await new AxeBuilder({ page: alice }).withTags(WCAG).include('#rm-review-panel').analyze();
    expect(axe.violations).toEqual([]);
    await alice.context().close();
  });

  test('an open-link reviewer names themselves once; group vs individual visibility holds', async ({ browser }) => {
    const bob = await reviewerPage(browser, links.open);
    await panel(bob).getByRole('textbox', { name: /^Your name/ }).fill('Bob');
    await panel(bob).getByRole('button', { name: 'Start reviewing' }).click();
    await expect(panel(bob).getByText('Reviewing as')).toContainText('Bob');
    // Group links see each other: Alice's threads are here.
    await expect(panel(bob).getByText('What is the source for this?')).toBeVisible();
    await addComment(bob, 'Looks good overall');
    // The name sticks across a reload (signed cookie, scoped to this link).
    await bob.reload();
    await expect(panel(bob).getByText('Reviewing as')).toContainText('Bob');
    await bob.context().close();

    const carol = await reviewerPage(browser, links.carol);
    await expect(panel(carol).getByText('The owner may later share them with other reviewers.')).toBeVisible();
    await expect(panel(carol).getByText('What is the source for this?')).toHaveCount(0);
    await addComment(carol, 'Carol private note');
    await carol.context().close();

    const alice = await reviewerPage(browser, links.alice);
    await expect(panel(alice).getByText('Looks good overall')).toBeVisible();
    await expect(panel(alice).getByText('Carol private note')).toHaveCount(0);
    await alice.context().close();
  });

  test('flipping a link to group warns with counts, then shares its past comments', async ({ page, browser }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);
    const carolCard = page.locator('div.rounded-md', { hasText: 'Review: Carol' });
    await carolCard.getByRole('button', { name: 'Switch to group…' }).click();
    await expect(page.getByRole('alert')).toContainText('This will make 1 comment from 1 reviewer visible');
    await page.getByRole('button', { name: 'Switch to group' }).click();
    await page.waitForURL(editUrl);

    const alice = await reviewerPage(browser, links.alice);
    await expect(panel(alice).getByText('Carol private note')).toBeVisible();
    await alice.context().close();
  });

  test('the owner replies and resolves in the preview overlay; the edit page summarises', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);
    await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
    await expect(page.getByText(/^5 open/)).toBeVisible();
    // The Share card says which links can comment.
    await expect(page.getByText('Can comment').first()).toBeVisible();

    // The owner's way in: the preview banner offers "Show comments".
    await page.goto(`/reports/${docId}?preview=1`);
    await expect(panel(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Show comments' }).click();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hide comments' })).toBeVisible();
    const thread = panel(page).locator('article', { hasText: 'What is the source for this?' });
    await thread.getByLabel(/^Reply to Alice/).fill('Finance deck, slide 4');
    await thread.getByRole('button', { name: 'Reply' }).click();
    await expect(panel(page).getByText('Finance deck, slide 4')).toBeVisible();

    await panel(page)
      .locator('article', { hasText: 'What is the source for this?' })
      .getByRole('button', { name: 'Resolve' })
      .click();
    await expect(panel(page).getByRole('status')).toHaveText('Thread resolved.');
    await expect(panel(page).getByText('Resolved (1)')).toBeVisible();
  });

  test('a GUI edit re-anchors comments: the removed figure marks its thread outdated', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);
    await page.getByLabel(/^page/i).fill('<h2>Quarter three</h2><p>Revenue grew 12% in Q3.</p>');
    await saveAndSettle(page);

    await page.goto(`/reports/${docId}?preview=1&review=1`);
    await expect(panel(page).locator('article', { hasText: 'Label the axes' })).toContainText('Outdated');
  });

  test('a save based on a stale copy is refused, not silently overwritten (D54)', async ({ page, browser }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);

    const other = await browser.newContext({ reducedMotion: 'reduce' });
    const second = await other.newPage();
    await loginAsAdmin(second);
    await second.goto(editUrl);
    await second.getByLabel(/^title/i).fill(`${TITLE} (agent)`);
    await saveAndSettle(second);
    await other.close();

    await page.getByLabel(/^title/i).fill(`${TITLE} (stale)`);
    await page.getByRole('button', { name: /Save changes/i }).click();
    await expect(page.getByRole('alert')).toContainText('someone else saved first');
    await page.reload();
    await expect(page.getByLabel(/^title/i)).toHaveValue(`${TITLE} (agent)`);
  });
});

// On a phone the panel flows after the article, so the sticky "Comments" button
// is how a reviewer finds it. Its own report + link, independent of the
// serial block above.
test.describe('Document review — narrow screens', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a reviewer on a phone sees the invite and a sticky button that jumps to comments', async ({ page, browser }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/reports/new');
    await page.getByLabel(/^title/i).fill(`Mobile review ${RUN}`);
    await page.getByLabel(/^page/i).fill('<p>A short page to review on a phone.</p>');
    await page.getByRole('button', { name: /Create Reports/i }).click();
    await page.waitForURL(/\/admin\/c\/reports\/doc_/);
    await page.getByText('New review link').click();
    await page.getByRole('button', { name: 'Create review link' }).click();
    const url = await linkUrl(page, 'Open review link');

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const reviewer = await ctx.newPage();
    await reviewer.goto(url);
    await expect(reviewer.getByRole('note')).toBeInViewport();
    const jump = reviewer.getByRole('link', { name: /^Comments \(0\)$/ });
    await expect(jump).toBeInViewport();
    await jump.click();
    await expect(reviewer.getByRole('textbox', { name: /^Your name/ })).toBeInViewport();
    await ctx.close();
  });
});
