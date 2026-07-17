import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';

// Distinct client IP so the login rate-limiter (SEC-2) buckets this file
// separately. (Named admin-graph, NOT graph — platform-graph-publish.spec.ts
// already owns the "graph" word for the relations feature suite.)
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.77' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Admin graph — the Nebulae relation explorer (D45)', () => {
  test('renders the canvas plate with an accessible baseline; legend chips work; axe-clean', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Reachable from the sidebar nav.
    await page.getByRole('link', { name: 'Graph' }).click();
    await page.waitForURL('**/admin/graph');
    await expect(page.getByRole('heading', { name: 'Graph' })).toBeVisible();

    // The seeded e2e DB has content, so the plate (not the empty state) renders:
    // a canvas with a REAL accessible name (item/relation counts baked in).
    const canvas = page.getByRole('img', { name: /Relation graph: \d+ items/ });
    await expect(canvas).toBeVisible();

    // The island parsed the embedded payload and mounted (double-mount guard flag).
    await expect(page.locator('[data-graph]')).toHaveAttribute('data-graph-mounted', '1');

    // Accessible equivalent: the hidden per-collection summary with links —
    // present in the DOM even though visually hidden.
    const summary = page.getByRole('region', { name: 'Graph summary' });
    await expect(summary.getByRole('link').first()).toHaveAttribute('href', /\/admin\/c\//);

    // Legend chips are real toggle buttons: keyboard-focusable, aria-pressed flips.
    const chip = page.locator('[data-graph-toggle]').first();
    await chip.focus();
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await chip.press('Enter');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.press('Enter');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // Axe sweeps the static state (loginAsAdmin emulates reduced motion, and
    // the island self-gates: no auto-drift under reduce).
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      axe.violations,
      `axe on /admin/graph: ${axe.violations.map((v) => v.id).join(',')}`,
    ).toEqual([]);
  });
});
