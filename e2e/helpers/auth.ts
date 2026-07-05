import type { Page } from '@playwright/test';

export const ADMIN_EMAIL = 'admin@remill.local';
export const ADMIN_PASSWORD = 'remilladmin';

/**
 * Sign in through the real login form (exercises the Datastar form post + session
 * cookie). Leaves the page on the post-login destination.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin');
}
