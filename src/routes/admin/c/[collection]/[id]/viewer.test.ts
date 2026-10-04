import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { getShareOverview } from '@/services/sharing';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import type { Env } from '@/types';

const NOW = '2026-10-04T12:00:00Z';
const PAGE =
  '<!doctype html><html><head><title>T</title></head><body><p id="marker">First</p></body></html>';

const PAGES: CollectionDefinition = {
  slug: 'pages',
  name: 'Pages',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true },
    { key: 'html', type: 'html', required: true },
  ],
  renderMode: 'frame',
};

/** The framed viewer on the admin surface (D60): the view page, and the share,
 *  restore and download handlers it drives. */
describe('admin framed viewer (D60)', () => {
  let db: Database;
  let env: Pick<Env, 'DB' | 'MEDIA' | 'SESSION_SECRET' | 'BASE_URL'>;
  let admin: Principal;
  let docId: string;
  let cookie: string;
  let base: string;

  const form = (fields: Record<string, string>, headers: Record<string, string> = {}) => ({
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await app.request(
      '/admin/login',
      form({ email, password, redirect: '/admin' }),
      env,
    );
    const cookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    return cookies[cookies.length - 1].split(';')[0];
  }

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    env = {
      DB: d1,
      MEDIA: {} as R2Bucket,
      SESSION_SECRET: 'x'.repeat(32),
      BASE_URL: 'http://test',
    };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, PAGES, NOW);
    docId = (
      await docs.createDocument(db, admin, 'pages', { title: 'Q3 Report: draft', html: PAGE }, NOW)
    ).id;
    await docs.updateDocument(
      db,
      admin,
      'pages',
      docId,
      { html: PAGE.replace('First', 'Second') },
      NOW,
    );
    await access.createUser(
      db,
      admin,
      { name: 'Col', email: 'col@remill.test', password: 'remilladmin', role: 'admin' },
      NOW,
    );
    await access.createUser(
      db,
      admin,
      { name: 'Rae', email: 'rae@remill.test', password: 'password1', role: 'reader' },
      NOW,
    );
    cookie = await login('col@remill.test', 'remilladmin');
    base = `/admin/c/pages/${docId}`;
  });

  const get = (path: string, as = cookie) => app.request(path, { headers: { Cookie: as } }, env);

  it('renders the viewer shell around a ticketed frame — never the html itself', async () => {
    const html = await (await get(`${base}/view`)).text();
    expect(html).toMatch(/<iframe[^>]+src="\/frame\/v1\.[^"]+"/);
    expect(html).toMatch(/sandbox="allow-scripts[^"]*"/);
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('id="marker"');
    // Owner actions.
    expect(html).toContain('id="rm-share"');
    expect(html).toContain('id="rm-versions"');
    expect(html).toContain(`${base}/download`);
  });

  it('?rev=N frames a past revision for an updater, with a restore notice', async () => {
    const html = await (await get(`${base}/view?rev=1`)).text();
    expect(html).toContain('Version 1 of 2');
    const ticket = html.match(/src="\/frame\/(v1\.[^"]+)"/)![1];
    expect(ticket.split('.')[2]).toBe('1');
    // Out-of-range or junk falls back to the current page.
    for (const rev of ['9', '-1', 'x', '2']) {
      expect(await (await get(`${base}/view?rev=${rev}`)).text(), rev).not.toContain(
        'This is not the current page',
      );
    }
  });

  it('a reader sees the page but no history, sharing or edit affordances', async () => {
    const reader = await login('rae@remill.test', 'password1');
    const html = await (await get(`${base}/view?rev=1`, reader)).text();
    expect(html).toContain('<iframe');
    expect(html).not.toContain('Version 1 of 2');
    expect(html.match(/src="\/frame\/(v1\.[^"]+)"/)![1].split('.')[2]).toBe('0');
    expect(html).not.toContain('id="rm-versions"');
    expect(html).not.toContain('id="rm-share"');
    // …and cannot download history either.
    expect((await get(`${base}/download?rev=1`, reader)).status).not.toBe(200);
  });

  it('download hands over the stored html as an attachment, current or past', async () => {
    const current = await get(`${base}/download`);
    expect(current.headers.get('content-disposition')).toBe(
      'attachment; filename="Q3-Report-draft.html"',
    );
    expect(await current.text()).toBe(PAGE.replace('First', 'Second'));
    const past = await get(`${base}/download?rev=1`);
    expect(past.headers.get('content-disposition')).toBe(
      'attachment; filename="Q3-Report-draft-v1.html"',
    );
    expect(await past.text()).toBe(PAGE);
  });

  it('the share handler answers the viewer with the manager only, and falls back to the view', async () => {
    const ds = { Cookie: cookie, 'Datastar-Request': 'true' };
    const viewer = await (
      await app.request(`${base}/share?surface=viewer`, form({ op: 'refresh' }, ds), env)
    ).text();
    expect(viewer).toContain('id="share-manager"');
    expect(viewer).not.toContain('id="share-summary"');
    // Its forms keep posting to the viewer surface.
    expect(viewer).toContain(`${base}/share?surface=viewer`);

    const editor = await (
      await app.request(`${base}/share`, form({ op: 'refresh' }, ds), env)
    ).text();
    expect(editor).toContain('id="share-summary"');

    const plain = await app.request(
      `${base}/share?surface=viewer`,
      form({ op: 'refresh' }, { Cookie: cookie }),
      env,
    );
    expect(plain.status).toBe(303);
    expect(plain.headers.get('location')).toBe(`${base}/view`);
    // The surface is a closed choice — anything else is the editor.
    const other = await app.request(
      `${base}/share?surface=//evil.test`,
      form({ op: 'refresh' }, { Cookie: cookie }),
      env,
    );
    expect(other.headers.get('location')).toBe(base);
  });

  it('restore returns to the viewer when asked, and appends a revision', async () => {
    const res = await app.request(
      `${base}/restore`,
      form({ revision: '1', return: 'view' }, { Cookie: cookie }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${base}/view`);
    const doc = await docs.getDocument(db, admin, 'pages', docId, NOW);
    expect(doc.revision).toBe(3);
    expect(doc.data.html).toBe(PAGE);
    const meta = await docs.listRevisionMeta(db, admin, 'pages', docId, NOW);
    expect(meta.map((m) => m.revision)).toEqual([3, 2, 1]);
    expect(meta[0]).not.toHaveProperty('data');
  });

  it('offers review links only where a comment panel renders', async () => {
    const opts = { secret: env.SESSION_SECRET, baseUrl: 'http://test' };
    // Framed: the panel sits in the viewer shell beside the frame.
    expect((await getShareOverview(db, admin, PAGES, docId, opts, NOW)).reviewLinks).toEqual([]);
    expect((await getShareOverview(db, admin, { ...PAGES, renderMode: 'shell' }, docId, opts, NOW)).reviewLinks).toEqual([]);
    // Raw: the author's bare document — nowhere for a panel.
    expect((await getShareOverview(db, admin, { ...PAGES, renderMode: 'raw' }, docId, opts, NOW)).reviewLinks).toBeNull();
  });

  it('?review=1 docks the review panel beside a marked frame — on the current version only', async () => {
    const plain = await (await get(`${base}/view`)).text();
    expect(plain).not.toContain('data-rm-review');
    expect(plain).not.toContain('data-rm-frame=');
    expect(plain).toContain(`${base}/view?review=1`);

    const reviewing = await (await get(`${base}/view?review=1`)).text();
    expect(reviewing).toContain('data-rm-review');
    expect(reviewing).toMatch(/<iframe[^>]+data-rm-frame[^>]+data-rm-field="html"/);
    expect(reviewing).toContain('rm-viewer-review');

    const past = await (await get(`${base}/view?rev=1&review=1`)).text();
    expect(past).toContain('Version 1 of 2');
    expect(past).not.toContain('data-rm-review');

    // A reader (no `comment`) is offered nothing and gets the plain view.
    const reader = await login('rae@remill.test', 'password1');
    const asReader = await (await get(`${base}/view?review=1`, reader)).text();
    expect(asReader).not.toContain('data-rm-review');
    expect(asReader).not.toContain('?review=1');
  });
});
