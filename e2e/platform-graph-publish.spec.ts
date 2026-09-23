import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately from the others.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.42' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Create a doc in `collection`, filling `fields` by label; returns its doc_ id.
 *  Markdown fields are CodeMirror islands since D38 — getByLabel would strict-
 *  violate on the (hidden textarea, CM textbox) pair, so those fill through
 *  the fillMarkdown helper instead. */
async function createDoc(page: Page, collection: string, fields: Record<string, string>): Promise<string> {
  await page.goto(`/admin/c/${collection}/new`);
  for (const [label, value] of Object.entries(fields)) {
    const isMarkdown = (await page.locator(`[data-md-editor]:has(textarea[name="${label}"])`).count()) > 0;
    if (isMarkdown) await fillMarkdown(page, new RegExp(`^${label}`, 'i'), value);
    else await page.getByLabel(label).fill(value);
  }
  await page.getByRole('button', { name: /Create /i }).click();
  await page.waitForURL(new RegExp(`/admin/c/${collection}/doc_`));
  const id = page.url().match(/(doc_[A-Za-z0-9_-]+)/)?.[1];
  expect(id, 'created doc id in URL').toBeTruthy();
  return id!;
}

// The roadmap acceptance flows (Tracks B & C), end to end through the real UI:
// any-data collections with relations (built in the BUILDER, zero code), the
// traversable graph, the lifecycle opt-out, the public rendered page, and the
// share link an outsider can open. Serial: later tests read what earlier ones made.
test.describe.serial('Roadmap — relations, graph, lifecycle, publish & share', () => {
  test('builder: a lifecycle-none records collection shows no Status affordances', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/collections/new');
    await page.getByLabel(/^Name/).fill('Companies');
    await page.getByLabel(/^Slug/).fill('companies');
    await page.getByLabel('Lifecycle').selectOption('none');
    await page.getByLabel('Key for field 1', { exact: true }).fill('name');
    await page.getByLabel('Indexed for field 1', { exact: true }).check();
    await page.getByRole('button', { name: /Create collection/i }).click();
    await page.waitForURL(/\/admin\/collections\/companies$/);

    // A record is not a draft blog post: no Status column, no publish button.
    await createDoc(page, 'companies', { name: 'ACME Corp' });
    await expect(page.getByRole('button', { name: /^Publish$/ })).toHaveCount(0);
    await expect(page.getByText('Status', { exact: true })).toHaveCount(0);
    await page.goto('/admin/c/companies');
    // exact: the bulk-select checkbox cell (D39) is also named "Select ACME Corp".
    await expect(page.getByRole('cell', { name: 'ACME Corp', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toHaveCount(0);
  });

  test('builder: a relation field via the relation editor; graph expands + backlinks', async ({ page }) => {
    await loginAsAdmin(page);

    // people.employer → companies, configured entirely in the builder UI.
    await page.goto('/admin/collections/new');
    await page.getByLabel(/^Name/).fill('People');
    await page.getByLabel(/^Slug/).fill('people');
    await page.getByLabel('Lifecycle').selectOption('none');
    await page.getByLabel('Key for field 1', { exact: true }).fill('name');
    await page.getByLabel('Indexed for field 1', { exact: true }).check();
    await page.getByRole('button', { name: /Add field/i }).click();
    await page.getByLabel('Key for field 2', { exact: true }).fill('employer');
    await page.getByLabel('Type for field 2', { exact: true }).selectOption('relation');
    await page.getByLabel('Target collection for field 2', { exact: true }).selectOption('companies');
    await page.getByLabel('Indexed for field 2', { exact: true }).check();
    await page.getByRole('button', { name: /Create collection/i }).click();
    await page.waitForURL(/\/admin\/collections\/people$/);

    // The company created by the previous test is the relation target.
    await page.goto('/admin/c/companies');
    await page.getByRole('link', { name: 'ACME Corp' }).click();
    const companyId = page.url().match(/(doc_[A-Za-z0-9_-]+)/)![1];

    const personId = await createDoc(page, 'people', { name: 'Ada Lovelace', employer: companyId });

    // Read-expansion: the person's detail view shows the company TITLE as a link.
    await page.goto(`/admin/c/people/${personId}/view`);
    await expect(page.getByRole('link', { name: 'ACME Corp' })).toBeVisible();

    // Backlinks: the company's edit page lists Ada under "Referenced by".
    await page.goto(`/admin/c/companies/${companyId}`);
    await expect(page.getByRole('heading', { name: 'Referenced by' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toBeVisible();
  });

  test('publish: a publicRead doc renders anonymously with markdown; drafts 404', async ({ page, browser }) => {
    await loginAsAdmin(page);

    // A publishable, publicly readable collection with an indexed slug.
    await page.goto('/admin/collections/new');
    await page.getByLabel(/^Name/).fill('Notes');
    await page.getByLabel(/^Slug/).fill('notes');
    await page.getByLabel('Lifecycle').selectOption('draft');
    await page.getByLabel('Visibility').selectOption('public');
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
    await page.waitForURL(/\/admin\/collections\/notes$/);

    await createDoc(page, 'notes', {
      title: 'Hello Public',
      slug: 'hello-public',
      body: '# Big Heading\n\nSome **bold** text and <script>alert(1)</script> raw HTML.',
    });

    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    // Draft: structurally invisible to the outside — a public 404, no admin redirect.
    const draftRes = await anonPage.goto('/notes/hello-public');
    expect(draftRes?.status()).toBe(404);
    await expect(anonPage.getByRole('heading', { name: 'Not found' })).toBeVisible();

    // Publish, then the rendered page is live: markdown → HTML, raw HTML escaped.
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();
    await anonPage.goto('/notes/hello-public');
    await expect(anonPage.getByRole('heading', { name: 'Hello Public' })).toBeVisible();
    await expect(anonPage.getByRole('heading', { name: 'Big Heading' })).toBeVisible();
    await expect(anonPage.locator('.rm-prose strong')).toHaveText('bold');
    await expect(anonPage.getByText('<script>', { exact: false })).toBeVisible(); // escaped, not executed
    const axe = await new AxeBuilder({ page: anonPage }).withTags(WCAG).analyze();
    expect(axe.violations, `axe on the public page: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    await anon.close();
  });

  test('share: a link grants an outsider read of a NON-public draft; revoke → 404', async ({ page, browser }) => {
    await loginAsAdmin(page);

    // A draft in `posts` (not publicRead) — maximally private.
    const docId = await createDoc(page, 'posts', { title: 'Secret Share Target' });

    // Mint the link from the Share panel (behind a disclosure); the plaintext
    // URL is shown exactly once.
    await page.locator('summary', { hasText: 'New share link' }).click();
    await page.getByRole('button', { name: 'Create link', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Share link created' })).toBeVisible();
    const url = await page.getByLabel('Share link URL').inputValue();
    expect(url).toContain('/s/rms_');

    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(url);
    await expect(anonPage.getByRole('heading', { name: 'Secret Share Target' })).toBeVisible();

    // Revoke from the Share links section (D51) → the same URL is a uniform
    // 404. Unscoped: this doc has exactly one share link and no item grants,
    // so "Revoke" is unique on the page (a `div`-ancestor filter chain here
    // strict-mode-violates — both the row and its list-container div satisfy
    // "has text 'link'", matching the button twice).
    await page.goto(`/admin/c/posts/${docId}`);
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.waitForURL(new RegExp(`/admin/c/posts/${docId}$`));
    const revokedRes = await anonPage.goto(url);
    expect(revokedRes?.status()).toBe(404);
    await expect(anonPage.getByRole('heading', { name: 'Not found' })).toBeVisible();

    await anon.close();
  });
});
