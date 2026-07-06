import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately from the others.
const SPEC_IP = '203.0.113.77';
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': SPEC_IP } });

// Serial retries re-run the whole group in a FRESH worker against the SAME D1
// state — unique-per-attempt names keep re-creates from colliding.
const RUN = Date.now().toString(36);
const TEAM = `Tech team ${RUN}`;
const MEMOS = `memos-${RUN}`;
const STU_EMAIL = `stu-${RUN}@e2e.local`;
const STU_PASSWORD = 'stu-password-1';

// Teams (D24) end to end through the real UI: create a team, mint a join link,
// an outsider registers through it, a doc is shared with the whole team, and
// the new member finds it under "Shared with me". Serial: later tests read
// what earlier ones made.
test.describe.serial('Teams — join links, team grants, shared-with-me', () => {
  let joinLink: string;

  test('admin creates a team and mints a join link (shown once)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/access/teams');
    await page.getByLabel(/^Name/).fill(TEAM);
    await page.getByLabel(/^Description/).fill('e2e team');
    await page.getByRole('button', { name: /Create team/i }).click();
    await page.waitForURL('**/admin/access/teams');
    await expect(page.getByText(TEAM, { exact: true }).first()).toBeVisible();

    // Mint a join link with the reader preset (the default) — the button is
    // aria-labelled per team card, so duplicate cards from retries can't collide.
    await page.getByRole('button', { name: `Mint join link for ${TEAM}`, exact: true }).click();
    await expect(page.getByText('Join link created')).toBeVisible();
    joinLink = (await page.locator('code').textContent())?.trim() ?? '';
    expect(joinLink).toContain('/auth/join/rmj_');
  });

  test('an outsider registers through the join link and can sign in', async ({ browser }) => {
    // A fresh, logged-out context — the invitee has no session.
    const context = await browser.newContext({ extraHTTPHeaders: { 'CF-Connecting-IP': SPEC_IP } });
    const page = await context.newPage();

    await page.goto(joinLink);
    await page.getByLabel(/^Name/).fill('Stu');
    await page.getByLabel(/^Email/).fill(STU_EMAIL);
    await page.getByLabel(/^Password/).fill(STU_PASSWORD);
    await page.getByLabel(/^Confirm password/).fill(STU_PASSWORD);
    await page.getByRole('button', { name: /Create account & join/i }).click();
    await page.waitForURL('**/admin/login');

    await page.getByLabel('Email').fill(STU_EMAIL);
    await page.getByLabel('Password').fill(STU_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin');
    await context.close();
  });

  test('admin shares a draft doc with the team; membership shows on the team card', async ({ page }) => {
    await loginAsAdmin(page);

    // Stu appears as a member of the team (joined via the link).
    await page.goto('/admin/access/teams');
    await expect(page.getByRole('button', { name: new RegExp(`Remove Stu from ${TEAM}`, 'i') })).toBeVisible();

    // A fresh collection + draft doc, shared to the team from the edit view.
    await page.goto('/admin/collections/new');
    await page.getByLabel(/^Name/).fill('Memos');
    await page.getByLabel(/^Slug/).fill(MEMOS);
    await page.getByLabel('Key for field 1', { exact: true }).fill('title');
    await page.getByLabel('Indexed for field 1', { exact: true }).check();
    await page.getByRole('button', { name: /Create collection/i }).click();
    await page.waitForURL(new RegExp(`/admin/collections/${MEMOS}$`));

    await page.goto(`/admin/c/${MEMOS}/new`);
    await page.getByLabel(/^title/i).fill('Quarterly architecture memo');
    await page.getByRole('button', { name: /Create /i }).click();
    await page.waitForURL(new RegExp(`/admin/c/${MEMOS}/doc_`));

    // Share panel: pick the team subject (read is pre-checked) and grant.
    await page.getByLabel('Grant to').selectOption({ label: TEAM });
    await page.getByRole('button', { name: /Grant access/i }).click();
    await expect(page.getByText('team', { exact: true }).first()).toBeVisible();

    // The matrix shows the team grant with its resolved name.
    await page.goto('/admin/access/matrix');
    await expect(page.getByText(TEAM, { exact: true }).first()).toBeVisible();
  });

  test('the team member finds the doc under "Shared with me" and can open it', async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'CF-Connecting-IP': SPEC_IP } });
    const page = await context.newPage();

    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(STU_EMAIL);
    await page.getByLabel('Password').fill(STU_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin');

    await page.goto('/admin/shared');
    const row = page.getByRole('link', { name: 'Quarterly architecture memo' });
    await expect(row).toBeVisible();
    await row.click();
    await page.waitForURL(new RegExp(`/admin/c/${MEMOS}/doc_[A-Za-z0-9_-]+/view`));
    await expect(page.getByText('Quarterly architecture memo').first()).toBeVisible();
    await context.close();
  });
});
