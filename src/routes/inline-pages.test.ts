import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import type { Env } from '@/types';

const NOW = '2026-10-08T12:00:00Z';
const PAGE =
  '<!doctype html><html lang="en"><head><title>T</title>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">' +
  '<style>*{margin:0} body{background:#123}</style></head>' +
  '<body class="dark"><p id="marker" data-on:click="alert(1)">First</p><script>window.ran = 1</script></body></html>';

const REPORTS: CollectionDefinition = {
  slug: 'reports',
  name: 'Reports',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true },
    { key: 'html', type: 'html', required: true },
  ],
  workflow: { lifecycle: 'none' },
  access: { publicRead: true },
  renderMode: 'inline',
};

/** Inline pages (D63): the document renders IN the viewer shell — on the
 *  admin, public and share surfaces — under the page CSP. */
describe('inline pages (D63)', () => {
  let db: Database;
  let env: Pick<Env, 'DB' | 'MEDIA' | 'SESSION_SECRET' | 'BASE_URL'>;
  let admin: Principal;
  let docId: string;
  let cookie: string;

  async function login(email: string, password: string): Promise<string> {
    const res = await app.request(
      '/admin/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, password, redirect: '/admin' }).toString(),
      },
      env,
    );
    const cookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    return cookies[cookies.length - 1].split(';')[0];
  }

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    env = { DB: d1, MEDIA: {} as R2Bucket, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://test' };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, REPORTS, NOW);
    docId = (await docs.createDocument(db, admin, 'reports', { title: 'Q3', html: PAGE }, NOW)).id;
    await docs.updateDocument(db, admin, 'reports', docId, { html: PAGE.replace('First', 'Second') }, NOW);
    await access.createUser(
      db,
      admin,
      { name: 'Col', email: 'col@remill.test', password: 'remilladmin', role: 'admin' },
      NOW,
    );
    cookie = await login('col@remill.test', 'remilladmin');
  });

  const get = (path: string, as?: string) =>
    app.request(path, as ? { headers: { Cookie: as } } : {}, env);

  const csp = (res: Response) => res.headers.get('Content-Security-Policy') ?? '';

  it('renders the page in place on the admin viewer — no iframe, Datastar off, scoped styles', async () => {
    const res = await get(`/admin/c/reports/${docId}/view`, cookie);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('<iframe');
    expect(html).toContain('id="marker"');
    expect(html).toContain('Second');
    expect(html).toContain('window.ran = 1');
    expect(html).toMatch(/<div class="rm-page dark"[^>]*data-ignore/);
    expect(html).toContain('data-rm-field="html"');
    expect(html).toContain('@scope (.rm-page)');
    expect(html).toContain(':scope{background:#123}');
    // Owner actions still on the bar.
    expect(html).toContain(`/admin/c/reports/${docId}/download`);
  });

  it('serves the page policy on an inline page, and the strict one elsewhere in admin', async () => {
    const page = csp(await get(`/admin/c/reports/${docId}/view`, cookie));
    expect(page).toContain('https://fonts.gstatic.com');
    expect(page).toContain('https://fonts.googleapis.com');
    expect(page).toContain('https://cdnjs.cloudflare.com');
    expect(page).toMatch(/connect-src 'self'(;|$)/);
    expect(page).toContain("frame-ancestors 'none'");

    const elsewhere = csp(await get('/admin/c/reports', cookie));
    expect(elsewhere).not.toContain('fonts.gstatic.com');
    expect(elsewhere).toContain("font-src 'self'");
  });

  it('?rev=N renders a past revision inline, with the restore notice', async () => {
    const html = await (await get(`/admin/c/reports/${docId}/view?rev=1`, cookie)).text();
    expect(html).toContain('Version 1 of 2');
    expect(html).toContain('First');
    expect(html).not.toContain('Second');
  });

  it('?review=1 docks the review panel beside the page', async () => {
    const html = await (await get(`/admin/c/reports/${docId}/view?review=1`, cookie)).text();
    expect(html).toContain('data-rm-review');
    expect(html).toContain('review.ts');
    expect(html).not.toContain('rm-viewer-review');
  });

  it('renders the public page inline, uncached, under the page policy', async () => {
    const res = await get(`/reports/${docId}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('id="marker"');
    expect(html).not.toContain('<iframe');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(csp(res)).toContain('https://fonts.gstatic.com');
  });
});
