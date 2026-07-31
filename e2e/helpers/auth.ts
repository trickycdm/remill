import type { Page } from '@playwright/test';

export const ADMIN_EMAIL = 'admin@remill.local';
export const ADMIN_PASSWORD = 'remilladmin';

/**
 * WORKAROUND (Playwright 1.61.1): the config's `use.reducedMotion: 'reduce'`
 * never reaches the default-fixture context (verified: project.use carries it,
 * context._options drops it; explicit `browser.newContext({ reducedMotion })`
 * works, which is why the manual-context public specs are unaffected). Without
 * it, entrance animations run and axe reads mid-fade alpha-blended colors —
 * flaky contrast failures with no real violation. Every admin spec routes
 * through loginAsAdmin, so emulating here restores the config's intent.
 * TODO: drop when upstream honours use.reducedMotion again.
 */
async function forceReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

/**
 * Sign in through the real login form (exercises the Datastar form post + session
 * cookie). Leaves the page on the post-login destination.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await forceReducedMotion(page);
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin');
}
