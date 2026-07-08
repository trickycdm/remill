import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.19' } });

// Serial-group retries re-run in a fresh worker against the SAME local D1 —
// per-attempt unique tokens keep reruns from colliding with stale rows.
const runId = Date.now().toString(36);
const TOKEN = `verdigris${runId}`;

test.describe('D28 — full-text search', () => {
  test('indexes on save; header box + / shortcut reach ranked results', async ({ page }) => {
    await loginAsAdmin(page);

    // Create a post whose title carries a unique token.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(`Search probe ${TOKEN}`);
    await fillMarkdown(page, /^body/i, `Body text mentioning ${TOKEN} twice, ${TOKEN}.`);
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    // '/' focuses the header search box (src/client/init.ts shortcut).
    await page.keyboard.press('Escape'); // make sure no field keeps focus
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    const box = page.getByRole('searchbox', { name: /search documents/i });
    await expect(box).toBeFocused();

    // Type the token and submit → the results page shows the hit with a snippet.
    await box.fill(TOKEN);
    await box.press('Enter');
    await expect(page).toHaveURL(/\/admin\/search\?q=/);
    const hit = page.getByRole('link', { name: new RegExp(TOKEN, 'i') });
    await expect(hit).toBeVisible();
    await expect(page.locator('mark').first()).toBeVisible(); // marked snippet

    // The hit links into the editor.
    await hit.click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);
  });

  test('no-match query renders the empty state, not an error', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/search?q=nonexistent${runId}xyz`);
    await expect(page.getByText(/no matches/i)).toBeVisible();
  });

  test('anonymous users are bounced to login', async ({ page }) => {
    await page.goto('/admin/search?q=anything');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
