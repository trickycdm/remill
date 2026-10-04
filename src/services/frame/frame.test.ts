import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { anonymousPrincipal, type Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import type { Env } from '@/types';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { FRAME_TICKET_TTL_SECONDS } from '@/lib/frame/ticket';
import { frameViewerOf, mintFrameSrc, readFramedDocument } from './index';

const NOW = '2026-10-04T12:00:00Z';
const FUTURE = '2026-10-20T12:00:00Z';
const SECRET = 's'.repeat(32);
const PAGE = '<!doctype html><html><head><title>T</title></head><body><p>First</p></body></html>';

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

const ticketOf = (src: string) => src.slice('/frame/'.length);

describe('frame service (D60) — the ticket names the viewer; authorize() decides', () => {
  let d1: D1Database;
  let db: Database;
  let admin: Principal;
  let docId: string;

  beforeEach(async () => {
    d1 = createTestD1();
    db = getDb(d1);
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, PAGES, NOW);
    docId = (await docs.createDocument(db, admin, 'pages', { title: 'One', html: PAGE }, NOW)).id;
  });

  const read = async (principal: Principal, revision = 0, at = NOW) =>
    readFramedDocument(
      db,
      SECRET,
      ticketOf(await mintFrameSrc(SECRET, principal, docId, NOW, revision)),
      at,
    );

  it('serves the page, preamble injected, to a principal who may read it', async () => {
    const html = await read(admin);
    expect(html).toContain('<p>First</p>');
    expect(html).toContain('data-rm-frame');
  });

  it('refuses a principal without read — the ticket confers nothing by itself', async () => {
    const stranger = await makePrincipal(db, NOW, { id: 'prn_stranger' });
    await expect(read(stranger)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(read(anonymousPrincipal('rest'))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a share-link viewer reads through the link grant — and stops the moment it is revoked', async () => {
    const { grantId, token } = await access.createShareLink(
      db,
      admin,
      { collection: 'pages', documentId: docId, actions: ['read'], expiresAt: FUTURE },
      SECRET,
      NOW,
    );
    const grant = (await access.resolveShareLink(db, token, NOW))!;
    const reader: Principal = { ...anonymousPrincipal('rest'), linkId: grant.subjectId };
    expect(frameViewerOf(reader)).toEqual({ kind: 'link', id: grant.subjectId });

    const src = await mintFrameSrc(SECRET, reader, docId, NOW);
    expect(await readFramedDocument(db, SECRET, ticketOf(src), NOW)).toContain('<p>First</p>');

    await access.revokeItem(db, admin, grantId, 'pages', docId, NOW);
    // The SAME still-unexpired ticket is now worthless.
    await expect(readFramedDocument(db, SECRET, ticketOf(src), NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('serves a past revision only to a principal who may update', async () => {
    await docs.updateDocument(
      db,
      admin,
      'pages',
      docId,
      { html: PAGE.replace('First', 'Second') },
      NOW,
    );
    expect(await read(admin)).toContain('<p>Second</p>');
    expect(await read(admin, 1)).toContain('<p>First</p>');
    await expect(read(admin, 99)).rejects.toBeInstanceOf(NotFoundError);

    const reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    await expect(read(reader, 1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses bad and expired tickets, and a collection that is no longer frame-mode', async () => {
    await expect(readFramedDocument(db, SECRET, 'nonsense', NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const expired = new Date(
      new Date(NOW).getTime() + (FRAME_TICKET_TTL_SECONDS + 1) * 1000,
    ).toISOString();
    await expect(read(admin, 0, expired)).rejects.toBeInstanceOf(NotFoundError);

    await collectionsService.updateCollection(
      db,
      admin,
      'pages',
      { ...PAGES, renderMode: 'shell' },
      NOW,
    );
    await expect(read(admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('GET /frame/:ticket', () => {
    const env = () =>
      ({ DB: d1, SESSION_SECRET: SECRET, BASE_URL: 'http://test' }) as Pick<
        Env,
        'DB' | 'SESSION_SECRET' | 'BASE_URL'
      >;

    it('answers with the document under the frame policy, cookieless', async () => {
      const src = await mintFrameSrc(SECRET, admin, docId, new Date().toISOString());
      const res = await app.request(src, {}, env());
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<p>First</p>');
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain('sandbox allow-scripts');
      expect(csp).not.toContain('allow-same-origin');
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("connect-src 'none'");
      expect(res.headers.get('x-frame-options')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('answers every refusal with one sandboxed 404', async () => {
      const stranger = await makePrincipal(db, NOW, { id: 'prn_stranger' });
      const denied = await mintFrameSrc(SECRET, stranger, docId, new Date().toISOString());
      const bodies = new Set<string>();
      for (const path of ['/frame/nonsense', denied]) {
        const res = await app.request(path, {}, env());
        expect(res.status, path).toBe(404);
        expect(res.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
        expect(res.headers.get('set-cookie')).toBeNull();
        bodies.add(await res.text());
      }
      expect(bodies.size).toBe(1);
    });
  });
});
