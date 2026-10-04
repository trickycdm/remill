import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin, ADMIN_PASSWORD } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
//
// Passkeys (D58) need a real hostname: browsers refuse an IP address as a WebAuthn
// relying-party id, so this spec alone talks to the preview server as `localhost`
// rather than 127.0.0.1 (src/lib/relying-party.ts honours that for loopback).
test.use({
  baseURL: 'http://localhost:3100',
  extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.58' },
});

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const NAME = `E2E key ${Date.now()}`; // unique per run — the local D1 persists between runs

/**
 * Attach Chromium's virtual authenticator: a platform passkey that verifies the
 * "user" automatically, so no OS prompt appears. Returns a switch for that
 * automatic approval. It must be OFF while the login page loads: the page offers
 * passkeys through the email box's autofill, and the virtual authenticator would
 * "pick" one instantly (a real browser waits for the person to choose).
 */
async function addVirtualAuthenticator(page: Page): Promise<(approve: boolean) => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return async (approve) => {
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: approve });
  };
}

async function signOut(page: Page): Promise<void> {
  await page.locator('#rm-user-menu-trigger').click();
  await page.locator('#rm-user-menu').getByRole('menuitem', { name: /sign out/i }).click();
  await page.waitForURL('**/admin/login');
}

test.describe('D58 — passkey login', () => {
  test('add a passkey, sign in with it, then remove it', async ({ page }) => {
    const autoApprove = await addVirtualAuthenticator(page);
    await loginAsAdmin(page);
    await page.goto('/admin/account');

    // A wrong password never reaches the browser's passkey prompt.
    await page.getByLabel('Passkey name').fill(NAME);
    await page.getByLabel('Confirm with your password').fill('definitely-not-it');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.locator('[data-passkey-add] [data-passkey-status]')).toHaveText(
      /current password is incorrect/i,
    );

    await page.getByLabel('Confirm with your password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    const row = page.getByRole('listitem').filter({ hasText: NAME });
    await expect(row).toContainText(/never used/i);

    const accountAxe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(accountAxe.violations, `axe on account: ${accountAxe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    // Sign out, then back in with the passkey alone — no email, no password.
    await autoApprove(false);
    await signOut(page);
    const loginAxe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(loginAxe.violations, `axe on login: ${loginAxe.violations.map((v) => v.id).join(',')}`).toEqual([]);
    await autoApprove(true);
    await page.getByRole('button', { name: 'Use a passkey' }).click();
    await page.waitForURL('**/admin');

    await page.goto('/admin/account');
    await expect(row).toContainText(/last used/i);

    // Remove it (confirmed through a dialog); the password is untouched.
    await page.getByRole('button', { name: `Remove ${NAME}`, exact: true }).click();
    await page.getByRole('button', { name: 'Remove passkey' }).click();
    await expect(row).toHaveCount(0);

    // The device still holds the credential, but the server no longer accepts it.
    await autoApprove(false);
    await signOut(page);
    await autoApprove(true);
    await page.getByRole('button', { name: 'Use a passkey' }).click();
    await expect(page.locator('[data-passkey-login] [data-passkey-status]')).toHaveText(
      /could not be used to sign in/i,
    );
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
