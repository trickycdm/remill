import type { Page } from '@playwright/test';

/**
 * Fill a markdown field in the admin editor. Since the CodeMirror island (D38)
 * the visible control is the CM contenteditable (role=textbox, named by the
 * field label — the underlying textarea is aria-hidden), so `getByLabel` would
 * strict-violate on the pair. Playwright's `fill` works on contenteditable;
 * CodeMirror syncs the hidden textarea via its update listener (§g).
 */
export async function fillMarkdown(page: Page, name: string | RegExp, text: string): Promise<void> {
  const editor = page.getByRole('textbox', { name });
  await editor.click();
  await editor.fill(text);
}
