import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin, ADMIN_EMAIL } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2: 10/min per
// CF-Connecting-IP) buckets each file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.13' } });

test.describe('Phase 1 — admin shell smoke + a11y', () => {
  test('unauthenticated admin routes bounce to login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('rejects bad credentials with an inline error', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect/i);
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('signs in and lands on a styled dashboard', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('dark/light theme toggle flips and persists', async ({ page }) => {
    await loginAsAdmin(page);
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.getByRole('button', { name: /theme|dark|light/i }).first().click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
    const after = await html.getAttribute('data-theme');
    // Persisted choice survives a reload (no-flash init reads localStorage).
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', after ?? '');
  });

  test('user menu opens (disclosure) and signs out', async ({ page }) => {
    await loginAsAdmin(page);
    const trigger = page.locator('#rm-user-menu-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('#rm-user-menu');
    await expect(menu.getByRole('menuitem', { name: /account settings/i })).toBeVisible();

    // Escape closes it (window handler).
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Reopen and sign out via the menu → back to login.
    await trigger.click();
    await menu.getByRole('menuitem', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

  test('login page passes axe (WCAG 2.1 AA)', async ({ page }) => {
    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle'); // let CSS/paint settle before contrast checks
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(r.violations).toEqual([]);
  });

  test('every admin page passes axe (WCAG 2.1 AA)', async ({ page }) => {
    await loginAsAdmin(page);
    for (const path of [
      '/admin',
      '/admin/c',
      '/admin/media',
      '/admin/collections',
      '/admin/access',
      '/admin/settings',
      '/admin/search?q=hello',
      '/admin/trash',
      '/admin/activity',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(r.violations, `axe violations on ${path}`).toEqual([]);
    }
  });
});
