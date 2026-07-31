import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.28' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Per-attempt unique names: serial-group retries re-run against the SAME D1.
const runId = Date.now().toString(36);
const TITLE = `Island post ${runId}`;

// A valid 1×1 transparent PNG (real magic bytes so sniffMime accepts it).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.serial('D38 — editor islands (CodeMirror + media picker)', () => {
  test('CodeMirror mounts, edits sync through the hidden textarea, and persist (§g)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/c/posts/new');

    // Island mounted: CodeMirror is up, the textarea is sr-only'd but present.
    const editor = page.locator('[data-md-editor] .cm-content');
    await expect(editor).toBeVisible();
    // The textarea stays in the DOM as the form/signal carrier, clipped
    // sr-only (a 1×1 box — Playwright still counts that as "visible", so
    // assert the mechanism, not visibility).
    const textarea = page.locator('[data-md-editor] textarea');
    await expect(textarea).toBeAttached();
    await expect(textarea).toHaveClass(/sr-only/);
    await expect(textarea).toHaveAttribute('aria-hidden', 'true');

    await page.getByLabel(/^title/i).fill(TITLE);
    await editor.click();
    await page.keyboard.type('# Typed in CodeMirror\n\nThe island syncs back.');

    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    // Persisted round trip: the editor re-mounts seeded from the saved value.
    await expect(page.locator('[data-md-editor] .cm-content')).toContainText('Typed in CodeMirror');

    // Axe on the enhanced editor page.
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations, `axe on editor: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);
  });

  test('media picker: browse, upload-and-use writes the id into the field', async ({ page }) => {
    await loginAsAdmin(page);

    // A collection with a media field, built in the builder UI (once per D1).
    const existing = await page.goto('/admin/collections/gallery');
    if (existing?.status() !== 200 || !(await page.getByRole('heading', { name: /gallery/i }).count())) {
      await page.goto('/admin/collections/new');
      await page.getByLabel(/^Name/).fill('Gallery');
      await page.getByLabel(/^Slug/).fill('gallery');
      await page.getByLabel('Lifecycle').selectOption('none');
      await page.getByLabel('Key for field 1', { exact: true }).fill('title');
      await page.getByLabel('Required for field 1', { exact: true }).check();
      await page.getByLabel('Indexed for field 1', { exact: true }).check();
      await page.getByRole('button', { name: /Add field/i }).click();
      await page.getByLabel('Key for field 2', { exact: true }).fill('photo');
      await page.getByLabel('Type for field 2', { exact: true }).selectOption('media');
      await page.getByRole('button', { name: /Create collection/i }).click();
      await page.waitForURL(/\/admin\/collections\/gallery$/);
    }

    await page.goto('/admin/c/gallery/new');
    await page.getByLabel(/^title/i).fill(`Shot ${runId}`);

    // The island unhides the Browse button; opening loads the fragment.
    const browse = page.getByRole('button', { name: 'Browse…' });
    await expect(browse).toBeVisible();
    await browse.click();
    const dialog = page.getByRole('dialog', { name: 'Media library' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-picker-file]')).toBeVisible();

    // Axe with the picker open (dialog + fragment content).
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations, `axe picker open: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    // Upload-and-use: the new asset's id lands in the field input, dialog closes.
    await dialog.locator('[data-picker-file]').setInputFiles({
      name: `dot-${runId}.png`,
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await dialog.locator('[data-picker-alt]').fill('A single transparent pixel');
    await dialog.getByRole('button', { name: /Upload & use/i }).click();
    await expect(dialog).not.toBeVisible();
    const idInput = page.locator('[data-media-picker] input[data-bind]');
    await expect(idInput).toHaveValue(/^med_/);

    // Selecting from the grid also works: reopen, pick the tile we uploaded.
    await idInput.fill('');
    await browse.click();
    await dialog.getByRole('button', { name: `Select dot-${runId}.png` }).click();
    await expect(dialog).not.toBeVisible();
    await expect(idInput).toHaveValue(/^med_/);

    // The whole form still saves through the Datastar signal (§g).
    await page.getByRole('button', { name: /Create Gallery/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/gallery\/doc_/);
    await expect(page.locator('[data-media-picker] input[data-bind]')).toHaveValue(/^med_/);
  });

  test('picker fragment is session-gated (anonymous is bounced)', async ({ browser }) => {
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    const res = await anonPage.goto('/admin/media/picker');
    expect(anonPage.url()).toContain('/admin/login');
    expect(res?.status()).toBe(200); // the login page, not the fragment
    await anon.close();
  });
});
