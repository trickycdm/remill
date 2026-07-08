import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.25' } });

// Per-attempt unique title: serial-group retries re-run against the SAME D1.
const runId = Date.now().toString(36);
const TITLE = `Scheduled ${runId}`;

test.describe('D32 — scheduled publishing', () => {
  test('schedule a draft from the sidebar, see the pending state, cancel it', async ({ page }) => {
    await loginAsAdmin(page);

    // Create a draft post.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(TITLE);
    await page.getByLabel(/^body/i).fill('Publishes itself later.');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    // Drafts offer the schedule affordance.
    const publishAt = page.getByLabel('Publish at');
    await expect(publishAt).toBeVisible();
    await publishAt.fill('2030-01-01T12:00');
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();

    // Pending state: the scheduled time replaces the input.
    await expect(page.getByText(/Scheduled for/i)).toBeVisible();
    await expect(page.getByLabel('Publish at')).toHaveCount(0);

    // Cancel restores the schedule form; the doc stays a draft.
    await page.getByRole('button', { name: 'Cancel schedule' }).click();
    await expect(page.getByLabel('Publish at')).toBeVisible();
    await expect(page.getByText('draft', { exact: true })).toBeVisible();
  });

  test('a published document offers no schedule affordance', async ({ page }) => {
    await loginAsAdmin(page);
    const live = `${TITLE} live`;
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(live);
    await page.getByLabel(/^body/i).fill('x');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('published', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Publish at')).toHaveCount(0);
  });
});
