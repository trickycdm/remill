import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.93' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// D57: a collection WITHOUT public pages shows every document as Private, with
// a locked Visibility card; "Enable public pages & apply" flips the collection
// and switches every OTHER document to private first, so only the chosen one
// goes live. Serial: later tests act on the collection + docs setup creates.
const runId = Date.now().toString(36);
const SLUG = `vis${runId}`;
const NAME = `Vis ${runId}`;

let firstEdit = '';
let firstId = '';
let secondId = '';

test.describe.serial('Safe enable of public pages (D57)', () => {
  test('setup: a private-by-default collection with two published docs', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/collections/new');
    await page.locator('[name="name"]').first().fill(NAME);
    const slug = page.locator('[name="slug"]').first();
    if (await slug.isEditable()) await slug.fill(SLUG);
    await page.locator('[name="field_0_key"]').fill('title');
    await page.locator('[name="field_0_type"]').selectOption('text');
    await page
      .getByRole('button', { name: /Create|Save/i })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/collections/${SLUG}`));

    for (const title of ['First', 'Second']) {
      await page.goto(`/admin/c/${SLUG}/new`);
      await page.getByLabel(/^title/i).fill(`${title} ${runId}`);
      await page.getByRole('button', { name: new RegExp(`Create ${NAME}`, 'i') }).click();
      await page.waitForURL(new RegExp(`/admin/c/${SLUG}/doc_`));
      const id = page.url().split('/').pop()!;
      if (title === 'First') {
        firstEdit = page.url();
        firstId = id;
      } else secondId = id;
    }
  });

  test('editor labels the doc Private and locks the control until pages are enabled', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(firstEdit);
    await expect(page.getByText(`${NAME} has no public pages.`, { exact: false })).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Private/ })).toBeChecked();
    const enable = page.getByRole('button', { name: 'Enable public pages & apply' });
    await expect(enable).toBeDisabled();
    await expect(
      page.getByText('The other 1 document will be set to Private first', { exact: false }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);

    // Nothing is anonymously reachable yet.
    const res = await page.context().browser()!.newContext();
    const anon = await res.newPage();
    expect((await anon.goto(`/${SLUG}/${firstId}`))?.status()).toBe(404);
    await res.close();
  });

  test('builder shows the existing-documents choice when switching to Public', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/collections/${SLUG}`);
    const choice = page.getByRole('radio', { name: /Keep them private/ });
    await expect(choice).toBeHidden();
    await page.getByLabel('Visibility').selectOption('public');
    await expect(choice).toBeVisible();
    await expect(choice).toBeChecked();
  });

  test('Enable public pages & apply exposes only the chosen document', async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto(firstEdit);
    await page.getByRole('radio', { name: /^Public/ }).check();
    await page.getByRole('button', { name: 'Enable public pages & apply' }).click();
    await page.waitForURL(firstEdit);
    // Now a publicRead collection: the ordinary three-way card, Public checked.
    await expect(page.getByRole('radio', { name: /^Public/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();

    const ctx = await browser.newContext();
    const anon = await ctx.newPage();
    expect((await anon.goto(`/${SLUG}/${firstId}`))?.status()).toBe(200);
    expect((await anon.goto(`/${SLUG}/${secondId}`))?.status()).toBe(404);
    await ctx.close();

    // The sibling reads Private in its own editor.
    await page.goto(`/admin/c/${SLUG}/${secondId}`);
    await expect(page.getByRole('radio', { name: /^Private/ })).toBeChecked();
  });
});
