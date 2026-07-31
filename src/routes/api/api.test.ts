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
    env = {
      DB: d1,
      MEDIA: {} as R2Bucket,
      SESSION_SECRET: 'x'.repeat(32),
      BASE_URL: 'http://test',
    };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);

    // An editor agent (full content perms) and a reader agent (published-only).
    const editorId = await access.createAgent(db, admin, 'editor-bot', NOW);
    await access.assignRole(db, admin, editorId, 'editor', '*', NOW);
    editorToken = (await access.issueToken(db, admin, { principalId: editorId, name: 't' }, NOW))
      .token;

    const readerId = await access.createAgent(db, admin, 'reader-bot', NOW);
    await access.assignRole(db, admin, readerId, 'reader', '*', NOW);
    readerToken = (await access.issueToken(db, admin, { principalId: readerId, name: 't' }, NOW))
      .token;

    // A token for the admin principal (manage_access) to drive the Share endpoint.
    adminToken = (
      await access.issueToken(db, admin, { principalId: admin.id, name: 'admin-t' }, NOW)
    ).token;
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
    const a = await req('/api/c/posts', {
      method: 'POST',
      headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Public One' }),
    });
    await req(`/api/c/posts/${a.json.data.id}/publish`, {
      method: 'POST',
      headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
      body: '{}',
    });
    await req('/api/c/posts', {
      method: 'POST',
      headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Secret Draft' }),
    });

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
    expect(r.json).toMatchObject({
      code: 'FORBIDDEN',
      missing: { action: 'create', collection: 'posts' },
    });
  });

  it('filter + sort over the document index (only indexed fields allowed)', async () => {
    for (const t of ['Banana', 'Apple', 'Cherry']) {
      const c = await req('/api/c/posts', {
        method: 'POST',
        headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      await req(`/api/c/posts/${c.json.data.id}/publish`, {
        method: 'POST',
        headers: { ...auth(editorToken), 'Content-Type': 'application/json' },
        body: '{}',
      });
    }
    const sorted = await req('/api/c/posts?sort=title', { headers: auth(editorToken) });
    expect(sorted.json.data.map((d: { data: { title: string } }) => d.data.title)).toEqual([
      'Apple',
      'Banana',
      'Cherry',
    ]);

    const filtered = await req('/api/c/posts?filter[title]=Apple', { headers: auth(editorToken) });
    expect(filtered.json.total).toBe(1);

    // Filtering a non-indexed field is a 400.
    const bad = await req('/api/c/posts?filter[body]=x', { headers: auth(editorToken) });
    expect(bad.status).toBe(400);
  });

  it('D42 packs: discovery is anonymous; install is manage_schema-gated with 201/403/409', async () => {
    // Anonymous discovery of both registries.
    const tpls = await req('/api/templates');
    expect(tpls.status).toBe(200);
    expect(tpls.json.data.map((t: { key: string }) => t.key)).toContain('article');

    const packs = await req('/api/packs');
    expect(packs.status).toBe(200);
    const blog = packs.json.data.find((p: { key: string }) => p.key === 'blog');
    expect(blog.installed).toBe(false);

    // Install without manage_schema → structured 403.
    const denied = await req('/api/packs/blog/install', {
      method: 'POST',
      headers: auth(readerToken),
    });
    expect(denied.status).toBe(403);

    // Install with manage_schema → 201 with the created definition(s); body optional.
    const created = await req('/api/packs/blog/install', {
      method: 'POST',
      headers: auth(adminToken),
    });
    expect(created.status).toBe(201);
    expect(created.json.data[0].slug).toBe('articles');

    // Repeat → 409; unknown pack → 404.
    const again = await req('/api/packs/blog/install', {
      method: 'POST',
      headers: auth(adminToken),
    });
    expect(again.status).toBe(409);
    const ghost = await req('/api/packs/ghost/install', {
      method: 'POST',
      headers: auth(adminToken),
    });
    expect(ghost.status).toBe(404);

    // Slug override rides the JSON body.
    const renamed = await req('/api/packs/blog/install', {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'essays' }),
    });
    expect(renamed.status).toBe(201);
    expect(renamed.json.data[0].slug).toBe('essays');

    // The OpenAPI doc advertises the static pack paths.
    const openapi = await req('/api/openapi.json');
    expect(Object.keys(openapi.json.paths)).toEqual(
      expect.arrayContaining(['/api/templates', '/api/packs', '/api/packs/{key}/install']),
    );
  });

  it('generates an OpenAPI document from the live definitions', async () => {
    const r = await req('/api/openapi.json');
    expect(r.status).toBe(200);
    expect(r.json.openapi).toBe('3.1.0');
    expect(r.json.paths['/api/c/posts']).toBeTruthy();
    expect(r.json.components.schemas.posts.properties.title).toBeTruthy();
  });

  it('D46: a private collection vanishes from anonymous discovery, /api/collections/:slug, and OpenAPI', async () => {
    const created = await req('/api/collections', {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'secret',
        name: 'Secret',
        shape: 'collection',
        fields: [{ key: 'title', type: 'text', required: true, index: true }],
        access: { private: true },
      }),
    });
    expect(created.status).toBe(201);

    // Anonymous list omits it entirely; the single-get 404s (indistinguishable
    // from nonexistent); an admin bearer sees the full definition.
    const anonList = await req('/api/collections');
    expect(anonList.json.data.some((c: { slug: string }) => c.slug === 'secret')).toBe(false);
    expect((await req('/api/collections/secret')).status).toBe(404);
    const adminGet = await req('/api/collections/secret', { headers: auth(adminToken) });
    expect(adminGet.status).toBe(200);
    expect(adminGet.json.data.access).toEqual({ private: true });

    // OpenAPI is caller-scoped: anonymous has neither the paths nor the schema;
    // an admin bearer widens the document.
    const anonApi = await req('/api/openapi.json');
    expect(anonApi.json.paths['/api/c/secret']).toBeUndefined();
    expect(anonApi.json.components.schemas.secret).toBeUndefined();
    expect(anonApi.json.paths['/api/c/posts']).toBeTruthy(); // non-private unaffected
    const adminApi = await req('/api/openapi.json', { headers: auth(adminToken) });
    expect(adminApi.json.paths['/api/c/secret']).toBeTruthy();
    expect(adminApi.json.components.schemas.secret).toBeTruthy();

    // Pack installed-status is caller-scoped (prompts pack ships private, D46).
    const install = await req('/api/packs/prompts/install', {
      method: 'POST',
      headers: auth(adminToken),
    });
    expect(install.status).toBe(201);
    const anonPacks = await req('/api/packs');
    expect(anonPacks.json.data.find((p: { key: string }) => p.key === 'prompts').installed).toBe(
      false,
    );
    const adminPacks = await req('/api/packs', { headers: auth(adminToken) });
    expect(adminPacks.json.data.find((p: { key: string }) => p.key === 'prompts').installed).toBe(
      true,
    );
  });

  it('D47 text renders: ?render= returns text/markdown; unknown render 422s; plain GET unchanged', async () => {
    const install = await req('/api/packs/collab/install', {
      method: 'POST',
      headers: auth(adminToken),
    });
    expect(install.status).toBe(201);

    const mkTask = await req('/api/c/tasks', {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'CSV export', goal: 'Ship the export.' }),
    });
    expect(mkTask.status).toBe(201);
    const mkWarp = await req('/api/c/warps', {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Session 1',
        task: mkTask.json.data.id,
        state: 'Happy path works.',
        open_questions: '- locale?',
        next_action: 'Wire the button.',
      }),
    });
    expect(mkWarp.status).toBe(201);
    const warpId = mkWarp.json.data.id as string;

    // The render arm returns raw markdown, not JSON (req() would choke — go direct).
    const res = await app.request(
      `/api/c/warps/${warpId}?render=implementer&budget=500`,
      { headers: auth(adminToken) },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const md = await res.text();
    expect(md.startsWith('# Session 1')).toBe(true);
    expect(md).toContain('\n## Next action');

    // Unknown render → the standard 422 listing what IS available.
    const bad = await req(`/api/c/warps/${warpId}?render=bogus`, { headers: auth(adminToken) });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.json.details)).toContain('reviewer, implementer');

    // A render name on a template WITHOUT renders is the same loud 422.
    const mkPost = await req('/api/c/posts', {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Plain post' }),
    });
    const noRenders = await req(`/api/c/posts/${mkPost.json.data.id}?render=reviewer`, {
      headers: auth(adminToken),
    });
    expect(noRenders.status).toBe(422);

    // Without ?render= the JSON read is byte-for-byte the old behavior.
    const plain = await req(`/api/c/warps/${warpId}`, { headers: auth(adminToken) });
    expect(plain.status).toBe(200);
    expect(plain.json.data.id).toBe(warpId);
  });
});
