import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { publishPage, getPagesCollection, UNTITLED_PAGE } from '@/services/pages';
import type { Principal } from '@/access';
import {
  AppError,
  ForbiddenError,
  InputValidationError,
  NotFoundError,
  StaleRevisionError,
} from '@/lib/errors';

const NOW = '2026-10-04T12:00:00Z';
const SECRET = 'x'.repeat(32);
const DAY = 24 * 60 * 60 * 1000;
const CTX = { secret: SECRET, baseUrl: 'http://test' };
const page = (title: string, body = '<h1>Heading</h1><p>Body</p>') =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

/** `publish_page` (D62) — one call to publish a standalone HTML page. */
describe('publishPage (D62)', () => {
  let d1: D1Database;
  let db: Database;
  let admin: Principal;
  let agent: Principal;

  beforeEach(async () => {
    d1 = createTestD1({ seed: true });
    db = getDb(d1);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    agent = await makePrincipal(db, NOW, {
      id: 'prn_bot',
      kind: 'agent',
      role: 'editor',
      surface: 'mcp',
    });
  });

  it('an editor-role agent publishes with no setup: titled from the page, private, with a viewer URL', async () => {
    const out = await publishPage(
      db,
      agent,
      { html: page('Q3 board pack'), description: 'For Friday', tags: ['board', 'q3'] },
      CTX,
      NOW,
    );
    expect(out).toMatchObject({
      title: 'Q3 board pack',
      revision: 1,
      visibility: 'private',
      share: null,
      warnings: [],
    });
    expect(out.url).toBe(`http://test/admin/c/pages/${out.id}/view`);
    const stored = await docs.getDocument(db, admin, 'pages', out.id, NOW);
    expect(stored.data).toMatchObject({
      title: 'Q3 board pack',
      description: 'For Friday',
      tags: ['board', 'q3'],
      html: page('Q3 board pack'),
    });
  });

  it('the title is the given one, else <title>, else the first <h1>, else a placeholder', async () => {
    const titled = (input: Record<string, unknown>) =>
      publishPage(db, agent, input, CTX, NOW).then((p) => p.title);
    expect(await titled({ html: page('From head'), title: '  Given  ' })).toBe('Given');
    expect(await titled({ html: '<h1>From heading</h1><p>x</p>' })).toBe('From heading');
    expect(await titled({ html: '<p>just a paragraph</p>' })).toBe(UNTITLED_PAGE);
  });

  it('publishing again with the id revises the SAME page; omitted fields keep their values', async () => {
    const first = await publishPage(
      db,
      agent,
      { html: page('One'), description: 'Kept', tags: ['a'] },
      CTX,
      NOW,
    );
    const second = await publishPage(db, agent, { id: first.id, html: page('Two') }, CTX, NOW);
    expect(second).toMatchObject({ id: first.id, url: first.url, revision: 2, title: 'One' });
    const stored = await docs.getDocument(db, admin, 'pages', first.id, NOW);
    expect(stored.data).toMatchObject({
      title: 'One',
      description: 'Kept',
      tags: ['a'],
      html: page('Two'),
    });
    // An explicit title does change it.
    expect(
      (
        await publishPage(
          db,
          agent,
          { id: first.id, html: page('Two'), title: 'Renamed' },
          CTX,
          NOW,
        )
      ).title,
    ).toBe('Renamed');
    expect((await docs.listRevisionMeta(db, admin, 'pages', first.id, NOW)).length).toBe(3);
  });

  it('refuses a save based on a stale revision, an unknown page, and missing html', async () => {
    const first = await publishPage(db, agent, { html: page('One') }, CTX, NOW);
    await publishPage(db, agent, { id: first.id, html: page('Two') }, CTX, NOW);
    await expect(
      publishPage(db, agent, { id: first.id, html: page('Three'), expectedRevision: 1 }, CTX, NOW),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    expect(
      (
        await publishPage(
          db,
          agent,
          { id: first.id, html: page('Three'), expectedRevision: 2 },
          CTX,
          NOW,
        )
      ).revision,
    ).toBe(3);
    await expect(
      publishPage(db, agent, { id: 'doc_missing', html: page('x') }, CTX, NOW),
    ).rejects.toSatisfy((e) => e instanceof NotFoundError || e instanceof ForbiddenError);
    for (const html of [undefined, '', '   ', 42]) {
      await expect(publishPage(db, agent, { html }, CTX, NOW)).rejects.toBeInstanceOf(
        InputValidationError,
      );
    }
  });

  it('mints a share or review link in the same call', async () => {
    const soon = '2026-10-10T12:00:00Z';
    const shared = await publishPage(
      db,
      agent,
      { html: page('S'), share: { expiresAt: soon, label: 'For Sam' } },
      CTX,
      NOW,
    );
    expect(shared.share).toMatchObject({ review: null, label: 'For Sam', hasPassword: false });
    expect(shared.share!.url).toMatch(/^http:\/\/test\/s\/rms_/);
    expect(shared.share).not.toHaveProperty('token');
    const grant = (await access.resolveShareLink(db, shared.share!.url.split('/s/')[1], NOW))!;
    expect(grant).toMatchObject({ documentId: shared.id, actions: ['read'] });

    const review = await publishPage(
      db,
      agent,
      { html: page('R'), share: { expiresAt: soon, review: { reviewer: 'Alice' } } },
      CTX,
      NOW,
    );
    expect(review.share!.review).toEqual({ mode: 'group', reviewer: 'Alice' });
    // A share without an expiry is refused — and nothing is left half-shared.
    await expect(
      publishPage(db, agent, { html: page('X'), share: {} }, CTX, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('reports what the frame will block, without refusing the page', async () => {
    const out = await publishPage(
      db,
      agent,
      {
        html: page(
          'W',
          '<script src="https://example.com/a.js"></script><script>fetch("/api")</script>',
        ),
      },
      CTX,
      NOW,
    );
    expect(out.revision).toBe(1);
    expect(out.warnings).toEqual([
      expect.stringContaining('Script https://example.com/a.js will not load'),
      expect.stringContaining('Network calls'),
    ]);
  });

  it('authorization and limits are the documents service’s own', async () => {
    const reader = await makePrincipal(db, NOW, {
      id: 'prn_reader',
      kind: 'agent',
      role: 'reader',
      surface: 'mcp',
    });
    await expect(publishPage(db, reader, { html: page('No') }, CTX, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const first = await publishPage(db, agent, { html: page('Mine') }, CTX, NOW);
    await expect(
      publishPage(db, reader, { id: first.id, html: page('Theirs') }, CTX, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // The html field's own length limit still applies.
    await expect(
      publishPage(db, agent, { html: `<p>${'x'.repeat(1_000_001)}</p>` }, CTX, NOW),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('is unavailable when the install has no framed pages collection', async () => {
    const bare = getDb(createTestD1());
    expect(await getPagesCollection(bare)).toBeNull();
    await expect(publishPage(bare, admin, { html: page('x') }, CTX, NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // A user's own `pages` collection that is not a framed page does not count.
    const { seedRoles } = await import('@/test/access');
    await seedRoles(bare, NOW);
    const owner = await makePrincipal(bare, NOW, { id: 'prn_owner', role: 'admin' });
    await collectionsService.createCollection(
      bare,
      owner,
      {
        slug: 'pages',
        name: 'Pages',
        shape: 'collection',
        fields: [{ key: 'title', type: 'text' }],
      },
      NOW,
    );
    expect(await getPagesCollection(bare)).toBeNull();
  });

  describe('MCP publish_page and REST /api/pages', () => {
    let editorToken: string;
    let readerToken: string;
    const env = () => ({
      DB: d1,
      MEDIA: {} as R2Bucket,
      SESSION_SECRET: SECRET,
      BASE_URL: 'http://test',
    });
    const future = () => new Date(Date.now() + 3 * DAY).toISOString();

    async function tokenFor(name: string, role: string) {
      const pid = await access.createAgent(db, admin, name, NOW);
      await access.assignRole(db, admin, pid, role, '*', NOW);
      return (await access.issueToken(db, admin, { principalId: pid, name: 't' }, NOW)).token;
    }

    async function mcp(token: string, method: string, params?: object) {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        },
        env(),
      );
      return ((await res.json()) as { result: Record<string, unknown> }).result;
    }
    const call = async (token: string, args: Record<string, unknown>) => {
      const result = (await mcp(token, 'tools/call', {
        name: 'publish_page',
        arguments: args,
      })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      return {
        ok: !result.isError,
        data: JSON.parse(result.content[0].text) as Record<string, unknown>,
      };
    };
    const rest = (token: string, path: string, init: RequestInit) =>
      app.request(
        path,
        {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.headers as Record<string, string>),
          },
        },
        env(),
      );

    beforeEach(async () => {
      editorToken = await tokenFor('page-bot', 'editor');
      readerToken = await tokenFor('reader-bot', 'reader');
    });

    it('the tool is offered to whoever can create or update pages, exactly once', async () => {
      const names = async (token: string) =>
        ((await mcp(token, 'tools/list')) as { tools: { name: string }[] }).tools.map(
          (t) => t.name,
        );
      expect((await names(editorToken)).filter((n) => n === 'publish_page')).toHaveLength(1);
      expect(await names(readerToken)).not.toContain('publish_page');
    });

    it('MCP and REST (JSON form) publish alike, share included', async () => {
      const args = {
        html: page('Parity'),
        tags: ['x'],
        share: { expiresAt: future(), review: { mode: 'individual' } },
      };
      const viaMcp = await call(editorToken, args);
      const res = await rest(editorToken, '/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('etag')).toBe('"1"');
      const viaRest = ((await res.json()) as { data: Record<string, unknown> }).data;
      expect(viaMcp.ok).toBe(true);
      for (const out of [viaMcp.data, viaRest]) {
        expect(Object.keys(out).sort()).toEqual([
          'id',
          'revision',
          'share',
          'title',
          'url',
          'visibility',
          'warnings',
        ]);
        expect(out).toMatchObject({
          title: 'Parity',
          revision: 1,
          visibility: 'private',
          warnings: [],
        });
        expect((out.share as { review: unknown }).review).toEqual({
          mode: 'individual',
          reviewer: null,
        });
      }
    });

    it('REST accepts a raw text/html body with metadata in the query, and PUT replaces it under If-Match', async () => {
      const created = await rest(
        editorToken,
        '/api/pages?title=From%20curl&tags=a,%20b&description=Raw',
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: page('Ignored in favour of the query'),
        },
      );
      expect(created.status).toBe(201);
      const first = ((await created.json()) as { data: { id: string; title: string } }).data;
      expect(first.title).toBe('From curl');
      const stored = await docs.getDocument(db, admin, 'pages', first.id, NOW);
      expect(stored.data).toMatchObject({ tags: ['a', 'b'], description: 'Raw' });

      const put = (ifMatch: string) =>
        rest(editorToken, `/api/pages/${first.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/html', 'If-Match': ifMatch },
          body: page('Second'),
        });
      const updated = await put('"1"');
      expect(updated.status).toBe(200);
      expect(updated.headers.get('etag')).toBe('"2"');
      expect(((await updated.json()) as { data: { title: string } }).data.title).toBe('From curl');
      const stale = await put('"1"');
      expect(stale.status).toBe(409);
      expect(((await stale.json()) as { code: string }).code).toBe('STALE_REVISION');
    });

    it('refuses other content types, oversized bodies and callers without create', async () => {
      const post = (token: string, type: string, body: string) =>
        rest(token, '/api/pages', { method: 'POST', headers: { 'Content-Type': type }, body });
      expect((await post(editorToken, 'text/plain', page('x'))).status).toBe(400);
      expect((await post(editorToken, 'application/json', '[1]')).status).toBe(400);
      expect((await post(editorToken, 'application/json', '{nope')).status).toBe(400);
      expect((await post(editorToken, 'text/html', 'x'.repeat(2 * 1024 * 1024 + 1))).status).toBe(
        413,
      );
      expect((await post(readerToken, 'text/html', page('x'))).status).toBe(403);
      expect((await call(readerToken, { html: page('x') })).ok).toBe(false);
      const anonymous = await app.request(
        '/api/pages',
        { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: page('x') },
        env(),
      );
      expect([401, 403]).toContain(anonymous.status);
    });
  });
});
