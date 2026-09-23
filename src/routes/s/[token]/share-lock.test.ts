/**
 * /s/:token route tests (D51): the locked-page leak boundary, the unlock POST
 * flow, and the noindex/no-store headers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { createShareLink } from '@/services/access';
import { SHARE_UNLOCK_LINK_RATE_LIMIT } from '@/middleware/rate-limit';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-09-23T12:00:00Z';

/** Minimal in-memory KV covering the get/put the limiter uses (mirrors
 *  security.test.ts's fakeKV). */
function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }, { key: 'body', type: 'markdown' }],
  workflow: { draftPublish: true },
};

describe('GET/POST /s/:token — password-protected share links (D51)', () => {
  let db: Database;
  let env: { DB: D1Database; MEDIA: R2Bucket; SESSION_SECRET: string; BASE_URL: string };
  let editor: Principal;
  let docId: string;

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    env = { DB: d1, MEDIA: {} as R2Bucket, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'https://example.org' };
    await seedRoles(db, NOW);
    const admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    editor = await makePrincipal(db, NOW, { id: 'prn_editor', role: 'editor' });
    await collectionsService.createCollection(db, admin, NOTES, NOW);
    docId = (await docs.createDocument(db, admin, 'notes', { title: 'Secret Title', body: 'Secret body prose.' }, NOW, { status: 'published' })).id;
  });

  it('unknown token 404s', async () => {
    const res = await app.request('/s/rms_does_not_exist', {}, env);
    expect(res.status).toBe(404);
  });

  it('a locked link leaks no title/description/OG/JSON-LD and carries no-store + noindex', async () => {
    const { token } = await createShareLink(
      db,
      editor,
      { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
      env.SESSION_SECRET,
      NOW,
    );
    const res = await app.request(`/s/${token}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const html = await res.text();
    expect(html).not.toContain('Secret Title');
    expect(html).not.toContain('Secret body');
    expect(html).not.toContain('og:');
    expect(html).not.toContain('ld+json');
    expect(html).not.toContain('name="description"');
  });

  it('JSON Accept on a locked link returns 401 LOCKED', async () => {
    const { token } = await createShareLink(
      db,
      editor,
      { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
      env.SESSION_SECRET,
      NOW,
    );
    const res = await app.request(`/s/${token}`, { headers: { Accept: 'application/json' } }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('LOCKED');
  });

  it('wrong password POST re-renders the locked page with a generic error', async () => {
    const { token } = await createShareLink(
      db,
      editor,
      { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
      env.SESSION_SECRET,
      NOW,
    );
    const res = await app.request(
      `/s/${token}`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('rm_unlock');
    const html = await res.text();
    expect(html).toContain('work');
    expect(html).toContain('role="alert"');
  });

  it('right password POST sets a cookie and 303s; the GET with that cookie then renders', async () => {
    const { token } = await createShareLink(
      db,
      editor,
      { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
      env.SESSION_SECRET,
      NOW,
    );
    const res = await app.request(
      `/s/${token}`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=hunter22' },
      env,
    );
    expect(res.status).toBe(303);
    const getSetCookie = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie;
    const setCookies = getSetCookie.call(res.headers);
    const unlockCookie = setCookies.find((c: string) => c.startsWith('rm_unlock='));
    expect(unlockCookie).toBeTruthy();
    expect(unlockCookie).toContain(`Path=/s/${token}`);
    expect(unlockCookie).toContain('HttpOnly');

    const cookieValue = unlockCookie!.split(';')[0];
    const opened = await app.request(`/s/${token}`, { headers: { Cookie: cookieValue } }, env);
    expect(opened.status).toBe(200);
    const html = await opened.text();
    expect(html).toContain('Secret Title');
    expect(html).toContain('og:title');
  });

  it('finding 17: a per-LINK unlock bucket rate-limits a distributed guesser even across many IPs', async () => {
    const { token } = await createShareLink(
      db,
      editor,
      { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
      env.SESSION_SECRET,
      NOW,
    );
    const withKv = { ...env, RATE_LIMIT: fakeKV() };
    const postFrom = (ip: string) =>
      app.request(
        `/s/${token}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
          body: 'password=wrong',
        },
        withKv,
      );

    // Each attempt comes from a DIFFERENT IP — the per-IP bucket (limit 10)
    // never trips, but the link-keyed bucket accumulates regardless of IP.
    const statuses: number[] = [];
    for (let i = 0; i < SHARE_UNLOCK_LINK_RATE_LIMIT.limit + 1; i++) {
      statuses.push((await postFrom(`10.0.0.${i}`)).status);
    }
    expect(statuses.slice(0, SHARE_UNLOCK_LINK_RATE_LIMIT.limit).every((s) => s !== 429)).toBe(true);
    expect(statuses[SHARE_UNLOCK_LINK_RATE_LIMIT.limit]).toBe(429);
  });

  it('an unprotected link opens directly with OG tags, noindex, and no canonical (private-safe by default is public here)', async () => {
    const { token } = await createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'] }, env.SESSION_SECRET, NOW);
    const res = await app.request(`/s/${token}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('og:title');
    expect(html).toContain('name="robots" content="noindex"');
  });
});
