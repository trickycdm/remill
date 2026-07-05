import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAsAdmin, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.15' } });

/**
 * Submit the security form. On success the route dsRedirects to /admin/account —
 * i.e. it reloads the SAME url, so `waitForURL` is a no-op and can't gate the
 * follow-up. Instead we wait for the reloaded (cleared) form, which also proves the
 * server finished the change before the test proceeds/ends (no lost in-flight POST).
 */
async function changePassword(page: Page, current: string, next: string): Promise<void> {
  await page.getByLabel('Current password').fill(current);
  await page.getByLabel(/^New password/).fill(next);
  await page.getByLabel('Confirm new password').fill(next);
  await page.getByRole('button', { name: /update password/i }).click();
  await expect(page.getByLabel('Current password')).toHaveValue('');
}

/** Sign out via the top-bar user menu (a native form POST → 303 to /admin/login). */
async function signOut(page: Page): Promise<void> {
  await page.locator('#rm-user-menu-trigger').click();
  await page.locator('#rm-user-menu').getByRole('menuitem', { name: /sign out/i }).click();
  await page.waitForURL('**/admin/login');
}

/** Log in with explicit credentials (loginAsAdmin only knows the seeded password). */
async function loginWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin');
}

test.describe('Phase 4 — account settings', () => {
  test('a wrong current password is rejected inline (no navigation)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/account');

    await page.getByLabel('Current password').fill('definitely-not-it');
    await page.getByLabel(/^New password/).fill('irrelevant123');
    await page.getByLabel('Confirm new password').fill('irrelevant123');
    await page.getByRole('button', { name: /update password/i }).click();

    await expect(page.locator('#security-result')).toContainText(/current password is incorrect/i);
    await expect(page).toHaveURL(/\/admin\/account$/);
  });

  test('changing the display name refreshes the top-bar user menu', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/account');

    await page.getByLabel('Display name').fill('Admin Renamed');
    await page.getByRole('button', { name: /save profile/i }).click();
    // The session cookie is refreshed (setSessionUser); the shell shows the new name
    // after the redirect-reload (the assertion auto-retries until it does).
    await expect(page.locator('#rm-user-menu-trigger')).toContainText('Admin Renamed');

    // Restore the seeded name so later specs observe the original state.
    await page.getByLabel('Display name').fill('Administrator');
    await page.getByRole('button', { name: /save profile/i }).click();
    await expect(page.locator('#rm-user-menu-trigger')).toContainText('Administrator');
  });

  test('changing the password: the new one works, the old one is rejected', async ({ page }) => {
    const NEW_PASSWORD = 'rotated-admin-pw-42';

    await loginAsAdmin(page);
    await page.goto('/admin/account');
    await changePassword(page, ADMIN_PASSWORD, NEW_PASSWORD);

    await signOut(page);

    // The OLD password no longer works (inline error, stays on login).
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect/i);

    // The NEW password does.
    await loginWith(page, ADMIN_EMAIL, NEW_PASSWORD);

    // Restore the seeded password so later specs' loginAsAdmin keeps working. The
    // helper waits for the reload, guaranteeing the change persists before teardown.
    await page.goto('/admin/account');
    await changePassword(page, NEW_PASSWORD, ADMIN_PASSWORD);
  });
});
