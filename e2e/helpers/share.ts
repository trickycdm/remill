import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Open the editor's Share drawer (idempotent) and return it. Sharing is
 * managed in a drawer, not the rail: the rail's Share section only carries a
 * summary and this trigger. The drawer stays open across share actions (they
 * re-render in place), so call this once per page load.
 */
export async function openShare(page: Page): Promise<Locator> {
  const drawer = page.getByRole('dialog', { name: 'Share' });
  if (!(await drawer.isVisible())) {
    await page.getByRole('button', { name: /^(Share…|Manage sharing…)$/ }).click();
    await expect(drawer).toBeVisible();
  }
  return drawer;
}

/** Open the drawer's "New link" form if it isn't already (it starts open only
 *  while the document has no links). */
export async function openNewLink(drawer: Locator): Promise<void> {
  const details = newLinkDetails(drawer);
  if ((await details.getAttribute('open')) === null) await details.locator('summary').first().click();
}

/** The "New link" disclosure. (`has` takes a locator RELATIVE to the match, so
 *  it is built from the page, not from the already-scoped drawer.) */
export function newLinkDetails(drawer: Locator): Locator {
  return drawer.locator('details', { has: drawer.page().locator('summary', { hasText: 'New link' }) });
}

/** One link's row in the drawer, found by its label. */
export function linkRow(drawer: Locator, label: string): Locator {
  return drawer.locator('li[data-share-link]', { hasText: label });
}

/** The copyable URL of the link labelled `label`. */
export async function linkUrl(page: Page, label: string): Promise<string> {
  const drawer = await openShare(page);
  return linkRow(drawer, label).locator('input[id^=share-link-url-]').inputValue();
}
