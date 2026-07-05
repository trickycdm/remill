import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.14' } });

// A real 1×1 red PNG (renders in the grid, sniffs as image/png).
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Phase 5 — media pipeline', () => {
  test('upload an image, serve it from R2, and satisfy a range request', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/media');

    await page.locator('input[type="file"]').setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: PNG });
    await page.getByLabel('Alt text', { exact: false }).first().fill('A red pixel');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/media/);

    // The asset renders in the grid; grab its /media/:id URL.
    const img = page.locator('img[src^="/media/"]').first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^\/media\/med_/);

    // Full fetch: correct content-type + immutable cache + accept-ranges.
    const full = await page.request.get(src!);
    expect(full.status()).toBe(200);
    expect(full.headers()['content-type']).toBe('image/png');
    expect(full.headers()['cache-control']).toContain('immutable');
    expect(full.headers()['accept-ranges']).toBe('bytes');

    // Range request: 206 Partial Content with a Content-Range header (seeking).
    const ranged = await page.request.get(src!, { headers: { Range: 'bytes=0-9' } });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()['content-range']).toMatch(/^bytes 0-9\//);
    expect((await ranged.body()).length).toBe(10);
  });

  test('MIME-spoof: a text file renamed .png is rejected', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/media');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'evil.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not an image', 'utf-8'),
    });
    await page.getByLabel('Alt text', { exact: false }).first().fill('nope');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    // Rejected → server returns a 400 (onError JSON), not a redirect to the library.
    await expect(page.getByText(/Unsupported or unrecognized/i)).toBeVisible();
  });

  test('media library passes axe (WCAG 2.1 AA)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/media');
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(r.violations).toEqual([]);
  });
});
