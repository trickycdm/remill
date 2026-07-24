import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/auth';

// Distinct client IP so this file's logins get their own SEC-2 bucket
// (10/min per CF-Connecting-IP) — the per-file convention, see admin-content.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.48' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const REDIRECT = 'http://127.0.0.1:39415/callback';
// RFC 7636 appendix B challenge (the verifier never leaves the client in e2e).
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** DCR through the real endpoint; page.request shares the browser context. */
async function registerClient(page: Page, name = 'Claude Code'): Promise<string> {
  const res = await page.request.post('/oauth/register', {
    data: { client_name: name, redirect_uris: [REDIRECT] },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeUrl(clientId: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: 'e2e-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/oauth/authorize?${q.toString()}`;
}

/** The callback port has no server — answer it in-page so navigation lands. */
async function stubCallback(page: Page): Promise<void> {
  await page.route(`${REDIRECT}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>callback</h1>' }),
  );
}

test.describe('OAuth consent (D48)', () => {
  test('logged-out authorize bounces through login and returns with the full query', async ({ page }) => {
    const clientId = await registerClient(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(authorizeUrl(clientId));
    await expect(page).toHaveURL(/\/admin\/login\?redirect=/);

    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Back on consent — state/challenge survived the round-trip.
    await page.waitForURL(/\/oauth\/authorize\?/);
    expect(page.url()).toContain('state=e2e-state');
    await expect(page.getByText('Claude Code').first()).toBeVisible();
    await expect(page.getByText('wants to access your remill')).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations).toEqual([]);
  });

  test('approve redirects to the callback with code + state; agent appears under Access', async ({ page }) => {
    // Register BEFORE login: page.request doesn't carry the session cookie, and
    // its response's fresh session cookie would clobber the logged-in one.
    const clientId = await registerClient(page, 'Consent Bot');
    await loginAsAdmin(page);
    await stubCallback(page);
    await page.goto(authorizeUrl(clientId));

    // Editor is the pre-selected default (user decision, D48).
    await expect(page.getByRole('radio', { name: /Editor/ })).toBeChecked();
    await page.getByRole('button', { name: /^Approve/ }).click();

    await page.waitForURL(/127\.0\.0\.1:39415\/callback/);
    const url = new URL(page.url());
    expect(url.searchParams.get('code')).toMatch(/^rmc_/);
    expect(url.searchParams.get('state')).toBe('e2e-state');

    // The auto-created agent principal shows in the directory with provenance.
    await page.goto('/admin/access');
    await expect(page.getByText('Consent Bot').first()).toBeVisible();
    await expect(page.getByText('via OAuth').first()).toBeVisible();
  });

  test('deny returns access_denied and creates nothing', async ({ page }) => {
    const clientId = await registerClient(page, 'Denied Bot');
    await loginAsAdmin(page);
    await stubCallback(page);
    await page.goto(authorizeUrl(clientId));
    await page.getByRole('button', { name: 'Deny', exact: true }).click();

    await page.waitForURL(/127\.0\.0\.1:39415\/callback/);
    const url = new URL(page.url());
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('e2e-state');

    await page.goto('/admin/access');
    await expect(page.getByText('Denied Bot')).toHaveCount(0);
  });

  test('untrusted client_name renders as text, never markup', async ({ page }) => {
    const clientId = await registerClient(page, '<b>evil</b>');
    await loginAsAdmin(page);
    await page.goto(authorizeUrl(clientId));
    await expect(page.getByText('<b>evil</b>').first()).toBeVisible(); // literal text
    expect(await page.locator('h1 b').count()).toBe(0); // never an element
  });

  test('invalid client_id renders the error card and never leaves the origin', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/oauth/authorize?client_id=ocl_bogus&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&response_type=code');
    await expect(page.getByText('This connection request is invalid')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/oauth/authorize');
  });
});
