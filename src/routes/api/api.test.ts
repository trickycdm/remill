import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import * as access from '@/services/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-04T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    { key: 'body', type: 'markdown' },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

describe('REST API — integration through the Hono app', () => {
  let db: Database;
  let env: { DB: D1Database; MEDIA: R2Bucket; SESSION_SECRET: string; BASE_URL: string };
  let admin: Principal;
  let adminToken: string;
  let editorToken: string;
  let readerToken: string;

  async function req(path: string, init: RequestInit = {}) {
    const res = await app.request(path, init, env);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    env = { DB: d1, MEDIA: {} as R2Bucket, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://test' };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);

    // An editor agent (full content perms) and a reader agent (published-only).
    const editorId = await access.createAgent(db, admin, 'editor-bot', NOW);
    await access.assignRole(db, admin, editorId, 'editor', '*', NOW);
    editorToken = (await access.issueToken(db, admin, { principalId: editorId, name: 't' }, NOW)).token;

    const readerId = await access.createAgent(db, admin, 'reader-bot', NOW);
    await access.assignRole(db, admin, readerId, 'reader', '*', NOW);
    readerToken = (await access.issueToken(db, admin, { principalId: readerId, name: 't' }, NOW)).token;

    // A token for the admin principal (manage_access) to drive the Share endpoint.
    adminToken = (await access.issueToken(db, admin, { principalId: admin.id, name: 'admin-t' }, NOW)).token;
  });

  it('rejects an invalid token with 401', async () => {
    const r = await req('/api/c/posts', { headers: auth('rmk_bogus') });
    expect(r.status).toBe(401);
  });

  it('Share (item grants): grant read on a draft, reader gains then loses access', async () => {
    // Editor creates a draft (born draft on a draftPublish collection).
    const created = await req('/api/c/posts', {
      method: 'POST',
      headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Secret Draft', body: 'shh' }),
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id;

    // The reader (published-only) cannot see the unpublished draft.
    const before = await req(`/api/c/posts/${id}`, { headers: auth(readerToken) });
    expect(before.status).not.toBe(200);

    // Admin grants the 'reader' role read on just this document.
    const granted = await req(`/api/c/posts/${id}/grants`, {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'role', subjectId: 'reader', actions: ['read'] }),
    });
    expect(granted.status).toBe(201);
    const grantId = granted.json.data.id;

    // Now the reader can read the otherwise-invisible draft.
    const after = await req(`/api/c/posts/${id}`, { headers: auth(readerToken) });
    expect(after.status).toBe(200);
    expect(after.json.data.data.title).toBe('Secret Draft');

    // The grant is listable, then revocable.
    const list = await req(`/api/c/posts/${id}/grants`, { headers: auth(adminToken) });
    expect(list.status).toBe(200);
    expect(list.json.data).toHaveLength(1);

    const revoked = await req(`/api/c/posts/${id}/grants`, {
      method: 'DELETE',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantId }),
    });
    expect(revoked.status).toBe(200);

    // Access is gone again.
    const gone = await req(`/api/c/posts/${id}`, { headers: auth(readerToken) });
    expect(gone.status).not.toBe(200);
  });

  it('editor token can create, read, update, publish, and delete a document', async () => {
    const created = await req('/api/c/posts', {
      method: 'POST',
      headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello REST', body: 'hi' }),
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id;
    expect(created.json.data.data.slug).toBe('hello-rest'); // slug derived by the engine
    expect(created.headers.get('X-RateLimit-Limit')).toBe('1000');

    const got = await req(`/api/c/posts/${id}`, { headers: auth(editorToken) });
    expect(got.status).toBe(200);
    expect(got.json.data.data.title).toBe('Hello REST');

    const patched = await req(`/api/c/posts/${id}`, {
      method: 'PATCH',
      headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello REST v2' }),
    });
    expect(patched.json.data.data.title).toBe('Hello REST v2');

    const published = await req(`/api/c/posts/${id}/publish`, {
      method: 'POST',
      headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish: true }),
    });
    expect(published.json.data.status).toBe('published');

    const del = await req(`/api/c/posts/${id}`, { method: 'DELETE', headers: auth(editorToken) });
    expect(del.status).toBe(200);
  });

  it('publicRead: anonymous sees published docs only; drafts never leak', async () => {
    // editor creates one published + one draft
    const a = await req('/api/c/posts', { method: 'POST', headers: { ...auth(editorToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Public One' }) });
    await req(`/api/c/posts/${a.json.data.id}/publish`, { method: 'POST', headers: { ...auth(editorToken), 'Content-Type': 'application/json' }, body: '{}' });
    await req('/api/c/posts', { method: 'POST', headers: { ...auth(editorToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Secret Draft' }) });

    const anon = await req('/api/c/posts'); // no token
    expect(anon.status).toBe(200);
    expect(anon.json.total).toBe(1);
    expect(anon.json.data.every((d: { status: string }) => d.status === 'published')).toBe(true);
  });

  it('denial: a reader token cannot create — structured 403 with `missing`', async () => {
    const r = await req('/api/c/posts', {
      method: 'POST',
      headers: { ...auth(readerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'nope' }),
    });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: 'FORBIDDEN', missing: { action: 'create', collection: 'posts' } });
  });

  it('filter + sort over the document index (only indexed fields allowed)', async () => {
    for (const t of ['Banana', 'Apple', 'Cherry']) {
      const c = await req('/api/c/posts', { method: 'POST', headers: { ...auth(editorToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
      await req(`/api/c/posts/${c.json.data.id}/publish`, { method: 'POST', headers: { ...auth(editorToken), 'Content-Type': 'application/json' }, body: '{}' });
    }
    const sorted = await req('/api/c/posts?sort=title', { headers: auth(editorToken) });
    expect(sorted.json.data.map((d: { data: { title: string } }) => d.data.title)).toEqual(['Apple', 'Banana', 'Cherry']);

    const filtered = await req('/api/c/posts?filter[title]=Apple', { headers: auth(editorToken) });
    expect(filtered.json.total).toBe(1);

    // Filtering a non-indexed field is a 400.
    const bad = await req('/api/c/posts?filter[body]=x', { headers: auth(editorToken) });
    expect(bad.status).toBe(400);
  });

  it('generates an OpenAPI document from the live definitions', async () => {
    const r = await req('/api/openapi.json');
    expect(r.status).toBe(200);
    expect(r.json.openapi).toBe('3.1.0');
    expect(r.json.paths['/api/c/posts']).toBeTruthy();
    expect(r.json.components.schemas.posts.properties.title).toBeTruthy();
  });
});
