import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file separately.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.70' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const runId = Date.now().toString(36);

test.describe('Prompt library pack — install, author, and the privacy default', () => {
  test('full flow: install, author a prompt with variables, publish — and the public page 404s', async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/marketplace');

    // The e2e D1 persists across local runs: exercise click-to-install on a
    // fresh DB (CI always is), fall through to the installed state otherwise.
    const installBtn = page.getByRole('button', { name: 'Install Prompt library' });
    if (await installBtn.isVisible().catch(() => false)) {
      await installBtn.click();
      // dsRedirect lands on the new collection's schema page.
      await page.waitForURL('**/admin/collections/prompts');
    }

    // Author + publish a prompt through the generated admin form.
    const title = `Release drafter ${runId}`;
    await page.goto('/admin/c/prompts/new');
    await page.getByLabel(/^title/i).fill(title);
    await fillMarkdown(
      page,
      /^body/i,
      'Draft release notes for {{version}} aimed at {{audience}}.',
    );
    await page.getByLabel(/^variables/i).fill('version, audience');
    await page.getByLabel(/^model/i).selectOption('claude');
    await page.getByRole('button', { name: /Create Prompt/i }).click();
    await page.waitForURL(/\/admin\/c\/prompts\/doc_/);

    // The admin detail view shows the authored content before publishing.
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Unpublish$/ })).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on /admin/c/prompts detail: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);

    // THE PRIVACY PIN: prompts ship private (D46) — even a PUBLISHED prompt has
    // no anonymous public page, AND the collection itself is invisible in every
    // anonymous discovery surface. This is the pack's defining difference from
    // blog/changelog/portfolio/docs.
    const anon = await browser.newContext({ reducedMotion: 'reduce' });
    const anonPage = await anon.newPage();
    const slug = `release-drafter-${runId}`;
    const resp = await anonPage.goto(`/prompts/${slug}`);
    expect(resp?.status()).toBe(404);

    // Discovery invisibility (mirrors the live anonymous curl probes): the
    // collection is absent from /api/collections, 404s on the single-get, and
    // has no OpenAPI paths; the pack reads uninstalled.
    const api = anon.request;
    const collections = await (await api.get('/api/collections')).json();
    expect(collections.data.some((c: { slug: string }) => c.slug === 'prompts')).toBe(false);
    expect((await api.get('/api/collections/prompts')).status()).toBe(404);
    const openapi = await (await api.get('/api/openapi.json')).json();
    expect(openapi.paths['/api/c/prompts']).toBeUndefined();
    const packs = await (await api.get('/api/packs')).json();
    expect(packs.data.find((p: { key: string }) => p.key === 'prompts')?.installed).toBe(false);
    await anon.close();
  });
});
