import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAsAdmin } from './helpers/auth';
import { fillMarkdown } from './helpers/editor';

// Distinct client IP per spec file so the login rate-limiter (SEC-2) buckets
// this file separately. See admin-content.spec.ts.
test.use({ extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.27' } });

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Per-attempt unique titles: serial-group retries re-run against the SAME D1.
const runId = Date.now().toString(36);
const ORIGINAL = `Exportable ${runId}`;
const EDITED = `Edited-by-import ${runId}`;
const ADDED = `Added-by-import ${runId}`;

test.describe.serial('D37 — import/export', () => {
  test('round trip: export the collection, edit + extend the NDJSON, import upserts', async ({ page }) => {
    await loginAsAdmin(page);

    // A document to export.
    await page.goto('/admin/c/posts/new');
    await page.getByLabel(/^title/i).fill(ORIGINAL);
    await fillMarkdown(page, /^body/i, 'Round-trip me.');
    await page.getByRole('button', { name: /Create Posts/i }).click();
    await expect(page).toHaveURL(/\/admin\/c\/posts\/doc_/);

    // Export via the admin download URL — in-page fetch so the SESSION cookie
    // applies (page.request does not carry it in this setup).
    const res = await page.evaluate(async () => {
      const r = await fetch('/admin/c/posts/export');
      return {
        status: r.status,
        contentType: r.headers.get('content-type') ?? '',
        disposition: r.headers.get('content-disposition') ?? '',
        text: await r.text(),
      };
    });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('application/x-ndjson');
    expect(res.disposition).toContain('posts-export.ndjson');
    const ndjson = res.text;
    expect(ndjson.split('\n')[0]).toContain('"remill-export"');
    expect(ndjson).toContain(ORIGINAL);

    // Edit the exported line (update path) and append a brand-new document line.
    const modified =
      ndjson.trimEnd().replace(ORIGINAL, EDITED) +
      '\n' +
      JSON.stringify({ kind: 'document', data: { title: ADDED, body: 'Imported fresh.' } }) +
      '\n';

    // The import page is axe-clean, then accepts the file.
    await page.goto('/admin/c/posts/import');
    const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(axe.violations, `axe on import page: ${axe.violations.map((v) => v.id).join(',')}`).toEqual([]);

    await page.getByLabel(/NDJSON file/i).setInputFiles({
      name: 'posts-export.ndjson',
      mimeType: 'application/x-ndjson',
      buffer: Buffer.from(modified, 'utf-8'),
    });
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByText(/Import complete/i)).toBeVisible();
    await expect(page.getByText(/1 created, .*updated, 0 failed/)).toBeVisible();

    // Both the edited and the added documents are in the list.
    await page.goto('/admin/c/posts');
    await expect(page.getByRole('cell', { name: EDITED }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: ADDED }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: ORIGINAL, exact: true })).toHaveCount(0);
  });

  test('dry run reports without writing', async ({ page }) => {
    await loginAsAdmin(page);
    const ndjson = await page.evaluate(async () => (await fetch('/admin/c/posts/export')).text());
    const dryTitle = `Dry-only ${runId}`;
    const withNew =
      ndjson.trimEnd() + '\n' + JSON.stringify({ kind: 'document', data: { title: dryTitle } }) + '\n';

    await page.goto('/admin/c/posts/import');
    await page.getByLabel(/NDJSON file/i).setInputFiles({
      name: 'dry.ndjson',
      mimeType: 'application/x-ndjson',
      buffer: Buffer.from(withNew, 'utf-8'),
    });
    await page.getByText(/Validate only/i).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByText(/Dry run — nothing was written/i)).toBeVisible();
    await page.goto('/admin/c/posts');
    await expect(page.getByRole('cell', { name: dryTitle })).toHaveCount(0);
  });
});
