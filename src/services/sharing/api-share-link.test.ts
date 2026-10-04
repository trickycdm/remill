import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as comments from '@/services/comments';
import * as docs from '@/services/documents';
import { mintApiShareLink, API_SHARE_LINK_MAX_TTL_DAYS } from '@/services/sharing';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { ForbiddenError, InputValidationError } from '@/lib/errors';

const NOW = '2026-10-04T12:00:00Z';
const SOON = '2026-10-10T12:00:00Z';
const SECRET = 'x'.repeat(32);
const DAY = 24 * 60 * 60 * 1000;

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
const RAW: CollectionDefinition = { ...PAGES, slug: 'sites', name: 'Sites', renderMode: 'raw' };
const PLAIN: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true }],
};

/** D61: agents may mint REVIEW links (read + comment) through the same door as
 *  read-only ones — one implementation for the MCP tool and the REST route. */
describe('mintApiShareLink (D61) — read-only and review links for API callers', () => {
  let d1: D1Database;
  let db: Database;
  let admin: Principal;
  let agent: Principal;
  let pageId: string;

  beforeEach(async () => {
    d1 = createTestD1();
    db = getDb(d1);
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    agent = await makePrincipal(db, NOW, {
      id: 'prn_bot',
      kind: 'agent',
      role: 'editor',
      surface: 'mcp',
    });
    for (const def of [PAGES, RAW, PLAIN])
      await collectionsService.createCollection(db, admin, def, NOW);
    pageId = (
      await docs.createDocument(db, admin, 'pages', { title: 'P', html: '<p>Hello there</p>' }, NOW)
    ).id;
  });

  const mint = (
    principal: Principal,
    input: Record<string, unknown>,
    collection = 'pages',
    documentId = pageId,
  ) => mintApiShareLink(db, principal, { collection, documentId, ...input }, SECRET, NOW);

  it('is read-only unless a review is asked for', async () => {
    const link = await mint(agent, { expiresAt: SOON, label: 'For Sam' });
    expect(link).toMatchObject({ review: null, label: 'For Sam', hasPassword: false });
    expect(Date.parse(link.expiresAt!)).toBe(Date.parse(SOON));
    const grant = (await access.resolveShareLink(db, link.token, NOW))!;
    expect(grant.actions).toEqual(['read']);
    expect(comments.isReviewLink(grant)).toBe(false);
    for (const review of [null, false])
      expect((await mint(agent, { expiresAt: SOON, review })).review).toBeNull();
  });

  it('an agent mints a review link: read + comment, group by default, optionally personal', async () => {
    const open = await mint(agent, { expiresAt: SOON, review: {} });
    expect(open.review).toEqual({ mode: 'group', reviewer: null });
    const grant = (await access.resolveShareLink(db, open.token, NOW))!;
    expect(grant.actions).toEqual(['read', 'comment']);
    expect(comments.isReviewLink(grant)).toBe(true);
    expect(open.label).toBe('Open review link');

    const personal = await mint(agent, {
      expiresAt: SOON,
      review: { mode: 'individual', reviewer: '  Alice  ' },
    });
    expect(personal.review).toEqual({ mode: 'individual', reviewer: 'Alice' });
    expect(personal.label).toBe('Review: Alice');
  });

  it('an expiry is required and clamped to 30 days, for both kinds', async () => {
    for (const review of [undefined, { mode: 'group' }]) {
      await expect(mint(agent, { review })).rejects.toBeInstanceOf(InputValidationError);
      const far = await mint(agent, { expiresAt: '2036-01-01T00:00:00Z', review });
      const ttl = Date.parse(far.expiresAt!) - Date.parse(NOW);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(API_SHARE_LINK_MAX_TTL_DAYS * DAY);
    }
  });

  it('a review link needs `comment` as well as `share_link` — the minter cannot hand out what it lacks', async () => {
    // A custom role with share_link + read but no comment.
    const sharer = await makePrincipal(db, NOW, {
      id: 'prn_sharer',
      kind: 'agent',
      role: 'reader',
      surface: 'mcp',
    });
    await access.grantItem(
      db,
      admin,
      {
        subjectKind: 'principal',
        subjectId: sharer.id,
        documentId: pageId,
        collection: 'pages',
        actions: ['read', 'share_link'],
      },
      NOW,
    );
    expect((await mint(sharer, { expiresAt: SOON })).review).toBeNull();
    await expect(mint(sharer, { expiresAt: SOON, review: {} })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // …and without share_link nothing is minted at all.
    const reader = await makePrincipal(db, NOW, {
      id: 'prn_reader',
      kind: 'agent',
      role: 'reader',
      surface: 'mcp',
    });
    await expect(mint(reader, { expiresAt: SOON })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a review link where no comment panel renders, and a bad mode', async () => {
    const rawId = (
      await docs.createDocument(db, admin, 'sites', { title: 'S', html: '<p>x</p>' }, NOW)
    ).id;
    const noteId = (await docs.createDocument(db, admin, 'notes', { title: 'N' }, NOW)).id;
    await expect(
      mint(agent, { expiresAt: SOON, review: {} }, 'sites', rawId),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      mint(agent, { expiresAt: SOON, review: {} }, 'notes', noteId),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      mint(agent, { expiresAt: SOON, review: { mode: 'everyone' } }),
    ).rejects.toBeInstanceOf(InputValidationError);
    // Read-only links are unaffected by the surface.
    expect((await mint(agent, { expiresAt: SOON }, 'sites', rawId)).review).toBeNull();
  });

  describe('MCP and REST answer alike', () => {
    let token: string;
    const env = () => ({
      DB: d1,
      MEDIA: {} as R2Bucket,
      SESSION_SECRET: SECRET,
      BASE_URL: 'http://test',
    });
    const future = () => new Date(Date.now() + 3 * DAY).toISOString();

    beforeEach(async () => {
      const pid = await access.createAgent(db, admin, 'review-bot', NOW);
      await access.assignRole(db, admin, pid, 'editor', '*', NOW);
      token = (await access.issueToken(db, admin, { principalId: pid, name: 't' }, NOW)).token;
    });

    async function viaMcp(args: Record<string, unknown>) {
      const res = await app.request(
        '/mcp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'share_link_pages', arguments: { id: pageId, ...args } },
          }),
        },
        env(),
      );
      const result = ((await res.json()) as { result: unknown }).result as {
        isError?: boolean;
        content: { text: string }[];
      };
      return {
        ok: !result.isError,
        data: JSON.parse(result.content[0].text) as Record<string, unknown>,
      };
    }

    async function viaRest(body: Record<string, unknown>) {
      const res = await app.request(
        `/api/c/pages/${pageId}/share-links`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        env(),
      );
      const json = (await res.json()) as { data?: Record<string, unknown>; code?: string };
      return { ok: res.status === 201, data: json.data ?? (json as Record<string, unknown>) };
    }

    it('both mint a review link with the same shape', async () => {
      for (const call of [viaMcp, viaRest]) {
        const r = await call({
          expiresAt: future(),
          review: { mode: 'individual', reviewer: 'Bo' },
        });
        expect(r.ok).toBe(true);
        expect(Object.keys(r.data).sort()).toEqual([
          'expiresAt',
          'grantId',
          'hasPassword',
          'label',
          'review',
          'url',
        ]);
        expect(r.data.review).toEqual({ mode: 'individual', reviewer: 'Bo' });
        expect(String(r.data.url)).toMatch(/^http:\/\/test\/s\/rms_/);
        const grant = (await access.resolveShareLink(
          db,
          String(r.data.url).split('/s/')[1],
          new Date().toISOString(),
        ))!;
        expect(grant.actions).toEqual(['read', 'comment']);
      }
    });

    it('both stay read-only by default, and both refuse a missing expiry and a bad mode', async () => {
      for (const call of [viaMcp, viaRest]) {
        expect((await call({ expiresAt: future() })).data.review).toBeNull();
        expect((await call({ review: {} })).ok).toBe(false);
        expect((await call({ expiresAt: future(), review: { mode: 'nope' } })).ok).toBe(false);
      }
    });
  });
});
