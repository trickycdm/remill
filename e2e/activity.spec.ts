import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.23' } });

test.describe('Phase 4 — audit surfacing', () => {
  test('the activity page lists decisions and the filter form narrows them', async ({ page }) => {
    await loginAsAdmin(page);
    // Generate at least one fresh allow row, then view the trail.
    await page.goto('/admin/c/posts');

    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1); // header + data

    // Filter to read actions — still renders rows, all labeled 'read'.
    await page.getByLabel(/filter by action/i).selectOption('read');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/action=read/);
    await expect(page.getByRole('cell', { name: 'read' }).first()).toBeVisible();
  });

  test('the dashboard recent-activity card shows the feed for admins', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expect(page.getByRole('link', { name: /all activity/i })).toBeVisible();
  });

  test('anonymous users are bounced to login', async ({ page }) => {
    await page.goto('/admin/activity');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
