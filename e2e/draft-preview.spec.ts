import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/auth';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.77' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Draft preview (D49): `?preview=1` + a session renders the public page through
// the session principal — drafts included — with the author banner, noindex,
// and fail-closed behavior for everyone else. Serial: later tests preview the
// draft the setup test creates.
const runId = Date.now().toString(36);
const TITLE = `Preview flow ${runId}`;

let previewUrl = '';
let editUrl = '';

test.describe.serial('Draft preview — the session-principal public render', () => {
  test('setup: the edit page of a fresh draft carries exactly one header action, Preview', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/articles/new');
    await page.getByLabel(/^title/i).fill(TITLE);
    await page.getByRole('button', { name: /Create Articles/i }).click();
    await page.waitForURL(/\/admin\/c\/articles\/doc_/);
    editUrl = page.url();

    // Preview: secondary, new-tab, ?preview=1 — the ONE header action while
    // still a DRAFT (publicRead collections get exactly one).
    const preview = page.getByRole('link', { name: /Preview public page/ });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('href', /^\/articles\/.+\?preview=1$/);
    await expect(preview).toHaveAttribute('target', '_blank');
    previewUrl = (await preview.getAttribute('href'))!;
  });

  test('an authed session previews the draft: page renders with banner + noindex', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(previewUrl);

    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText(/Draft preview — this page is not publicly visible/)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

    // Axe: the banner (accent fill) must hold AA like the rest of the page.
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on draft preview: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);

    // "Back to editor" round-trips to the edit page.
    await page.getByRole('link', { name: 'Back to editor' }).click();
    await page.waitForURL(/\/admin\/c\/articles\/doc_/);
  });

  test('anonymous: the bare URL is an indistinguishable 404; ?preview=1 routes through login and back', async ({
    browser,
  }) => {
    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();

    // Without the flag: the same 404 as any missing page (no existence leak).
    const bare = await anonPage.goto(previewUrl.replace('?preview=1', ''));
    expect(bare?.status()).toBe(404);
    await expect(anonPage.getByText(/doesn't exist or isn't public/)).toBeVisible();

    // With the flag: redirected to login BEFORE any lookup…
    await anonPage.goto(previewUrl);
    await anonPage.waitForURL(/\/admin\/login\?redirect=/);

    // …and signing in lands back on the preview.
    await anonPage.getByLabel('Email').fill(ADMIN_EMAIL);
    await anonPage.getByLabel('Password').fill(ADMIN_PASSWORD);
    await anonPage.getByRole('button', { name: /sign in/i }).click();
    await anonPage.waitForURL(/\?preview=1/);
    await expect(anonPage.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(
      anonPage.getByText(/Draft preview — this page is not publicly visible/),
    ).toBeVisible();

    await anon.close();
  });

  test('published: ?preview=1 shows the live-page banner; the bare page carries neither banner nor noindex', async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto(editUrl);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();

    await page.goto(previewUrl);
    await expect(page.getByText(/Preview — this is the live published page/)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();
    await anonPage.goto(previewUrl.replace('?preview=1', ''));
    await expect(anonPage.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(anonPage.getByText(/Draft preview|live published page/)).toHaveCount(0);
    await expect(anonPage.locator('meta[name="robots"]')).toHaveCount(0);
    await anon.close();
  });

  test('a non-publicRead collection gets no Preview; View steps up as the header affordance', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(`No preview ${runId}`);
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await page.waitForURL(/\/admin\/c\/posts\/doc_/);

    await expect(page.getByRole('link', { name: /Preview public page/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View', exact: true })).toBeVisible();
  });
});
