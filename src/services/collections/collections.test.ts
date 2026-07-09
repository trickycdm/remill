import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as svc from '@/services/collections';
import type { Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';
import { InputValidationError, ForbiddenError, ConflictError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';

const valid: CollectionDefinition = {
  slug: 'articles',
  name: 'Articles',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true },
    { key: 'meta', type: 'json' },
  ],
};

function bad(partial: Partial<CollectionDefinition>): CollectionDefinition {
  return { ...valid, ...partial };
}

describe('collections service — definition validation', () => {
  let db: Database;
  let admin: Principal;
  let editor: Principal; // has the editor role — which lacks manage_schema

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    editor = await makePrincipal(db, NOW, { id: 'prn_ed', role: 'editor' });
  });

  it('creates a valid collection', async () => {
    const def = await svc.createCollection(db, admin, valid, NOW);
    expect(def.slug).toBe('articles');
    expect(await svc.getCollection(db, 'articles')).not.toBeNull();
  });

  it('defaults a slug field to indexed (its purpose is the URL), but respects an explicit opt-out', () => {
    // Regression guard: an un-indexed slug silently 404s on the public route and
    // drops out of RSS/sitemap/canonical (getDocumentBySlug + publicUrlOf both
    // resolve via the index). Normalization defaults slug fields to index:true.
    const def = svc.validateDefinition(
      bad({ slug: 'posts', fields: [{ key: 'slug', type: 'slug' }, { key: 'body', type: 'markdown' }] }),
    );
    expect(def.fields.find((f) => f.key === 'slug')?.index).toBe(true);
    // A deliberate opt-out (slug used as a plain normalized string, not a URL) survives.
    const optOut = svc.validateDefinition(
      bad({ slug: 'posts2', fields: [{ key: 'slug', type: 'slug', index: false }, { key: 'body', type: 'markdown' }] }),
    );
    expect(optOut.fields.find((f) => f.key === 'slug')?.index).toBe(false);
  });

  it('accepts publicRead but rejects an inline role→action access map (dead config removed)', async () => {
    // publicRead is the only collection access knob — accepted.
    await svc.createCollection(db, admin, bad({ slug: 'pub', access: { publicRead: true } }), NOW);
    // A role→action map (once accepted, stored, and silently ignored) is now rejected.
    const roleMap = { editor: ['read', 'update'] } as unknown as { publicRead?: boolean };
    await expect(
      svc.createCollection(db, admin, bad({ slug: 'roled', access: roleMap }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("D27: renderMode 'raw' requires an html field; bad values rejected; round-trips through storage", async () => {
    // raw + html field → accepted, and the mode survives the DB round-trip.
    await svc.createCollection(
      db,
      admin,
      bad({ slug: 'pages', renderMode: 'raw', fields: [{ key: 'page', type: 'html', required: true }] }),
      NOW,
    );
    expect((await svc.getCollection(db, 'pages'))?.renderMode).toBe('raw');

    // raw without any html field → nothing could render; rejected.
    await expect(
      svc.createCollection(db, admin, bad({ slug: 'rawless', renderMode: 'raw' }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);

    // Outside the enum → rejected.
    await expect(
      svc.createCollection(db, admin, bad({ slug: 'weird', renderMode: 'fullscreen' as never }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);

    // 'shell' (the default, spelled out) is fine and stored as such.
    await svc.createCollection(db, admin, bad({ slug: 'shelled', renderMode: 'shell' }), NOW);
    expect((await svc.getCollection(db, 'shelled'))?.renderMode).toBe('shell');
  });

  it("B4: accepts lifecycle 'none'; rejects the contradictory none+draftPublish combo", async () => {
    await svc.createCollection(db, admin, bad({ slug: 'records', workflow: { lifecycle: 'none' } }), NOW);
    await expect(
      svc.createCollection(
        db,
        admin,
        bad({ slug: 'contradiction', workflow: { lifecycle: 'none', draftPublish: true } }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('accepts a relation field with zero allowlist edits (registry IS the gate)', async () => {
    const def = await svc.createCollection(
      db,
      admin,
      bad({
        slug: 'graph',
        fields: [
          { key: 'title', type: 'text', required: true, index: true },
          { key: 'author', type: 'relation', config: { collection: 'people' }, index: true },
          { key: 'refs', type: 'relation', config: { collection: 'graph', multiple: true }, index: true },
        ],
      }),
      NOW,
    );
    expect(def.slug).toBe('graph');
  });

  it('rejects unique on a multi-valued relation (shared unique_key → false collisions)', async () => {
    await expect(
      svc.createCollection(
        db,
        admin,
        bad({
          slug: 'rel-u',
          fields: [
            { key: 'title', type: 'text', required: true, index: true },
            { key: 'refs', type: 'relation', config: { collection: 'people', multiple: true }, index: true, unique: true },
          ],
        }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects a relation without a target collection (config gate)', async () => {
    await expect(
      svc.createCollection(
        db,
        admin,
        bad({
          slug: 'rel-bad',
          fields: [{ key: 'ref', type: 'relation', index: true }],
        }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects a bad slug', async () => {
    await expect(svc.createCollection(db, admin, bad({ slug: 'Bad Slug' }), NOW)).rejects.toBeInstanceOf(
      InputValidationError,
    );
  });

  it('C2: rejects URL-reserved slugs (static route segments would shadow them)', async () => {
    for (const slug of ['admin', 'api', 's', 'vendor']) {
      await expect(svc.createCollection(db, admin, bad({ slug }), NOW)).rejects.toBeInstanceOf(
        InputValidationError,
      );
    }
  });

  it('rejects an unknown field type', async () => {
    await expect(
      svc.createCollection(db, admin, bad({ fields: [{ key: 'x', type: 'wormhole' }] }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects a reserved field key', async () => {
    await expect(
      svc.createCollection(db, admin, bad({ fields: [{ key: 'status', type: 'text' }] }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects duplicate field keys', async () => {
    await expect(
      svc.createCollection(
        db,
        admin,
        bad({ fields: [{ key: 'a', type: 'text' }, { key: 'a', type: 'number' }] }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects index:true on a non-indexable type (json)', async () => {
    await expect(
      svc.createCollection(db, admin, bad({ fields: [{ key: 'blob', type: 'json', index: true }] }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects invalid per-field config', async () => {
    await expect(
      svc.createCollection(
        db,
        admin,
        // select requires a non-empty options array
        bad({ fields: [{ key: 'k', type: 'select', config: { options: [] } }] }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('denies a non-admin (needs manage_schema)', async () => {
    await expect(svc.createCollection(db, editor, valid, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a duplicate collection slug', async () => {
    await svc.createCollection(db, admin, valid, NOW);
    await expect(svc.createCollection(db, admin, valid, NOW)).rejects.toBeInstanceOf(ConflictError);
  });

  it('protects seeded collections from deletion', async () => {
    await svc.createCollection(db, admin, { ...valid, protected: true }, NOW);
    await expect(svc.deleteCollection(db, admin, 'articles', NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('collections service — discovery projection (SEC-5) + access/workflow validation (SEC-6)', () => {
  let db: Database;
  let admin: Principal;
  const anon: Principal = { id: 'anonymous', kind: 'user', surface: 'rest' };

  const posts: CollectionDefinition = {
    slug: 'posts',
    name: 'Posts',
    shape: 'collection',
    fields: [
      { key: 'title', type: 'text', label: 'Title', required: true, index: true },
      { key: 'body', type: 'markdown' },
    ],
    workflow: { draftPublish: true },
    access: { publicRead: true },
  };

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await svc.createCollection(db, admin, posts, NOW);
  });

  it('SEC-5: anonymous discovery omits internal access/workflow but keeps field shape', async () => {
    const list = await svc.listCollectionsForDiscovery(db, anon);
    const p = list.find((c) => c.slug === 'posts')!;
    expect(p.name).toBe('Posts');
    expect((p as unknown as Record<string, unknown>).access).toBeUndefined();
    expect((p as unknown as Record<string, unknown>).workflow).toBeUndefined();
    expect(p.fields.map((f) => f.key)).toEqual(['title', 'body']);
    expect(p.fields[0]).toMatchObject({ key: 'title', type: 'text', label: 'Title', required: true });
    // Field internals (index/config/admin) are not exposed to anonymous callers.
    expect((p.fields[0] as unknown as Record<string, unknown>).index).toBeUndefined();
  });

  it('SEC-5: a schema manager sees the FULL definition, internals included', async () => {
    const list = await svc.listCollectionsForDiscovery(db, admin);
    const p = list.find((c) => c.slug === 'posts')!;
    expect((p as unknown as Record<string, unknown>).access).toEqual({ publicRead: true });
    expect((p as unknown as Record<string, unknown>).workflow).toEqual({ draftPublish: true });
  });

  it('SEC-5: getCollectionForDiscovery projects the single-collection read too', async () => {
    const asAnon = await svc.getCollectionForDiscovery(db, anon, 'posts');
    expect((asAnon as unknown as Record<string, unknown>).access).toBeUndefined();
    const asAdmin = await svc.getCollectionForDiscovery(db, admin, 'posts');
    expect((asAdmin as unknown as Record<string, unknown>).access).toEqual({ publicRead: true });
  });

  it('SEC-6: rejects a malformed workflow config', async () => {
    await expect(
      svc.createCollection(db, admin, { ...posts, slug: 'bad-wf', workflow: { draftPublish: 'yes' as unknown as boolean } }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('SEC-6: rejects a malformed access config', async () => {
    await expect(
      svc.createCollection(db, admin, { ...posts, slug: 'bad-acc', access: { publicRead: 'nope' as unknown as boolean } }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  // (The former "SEC-6 accepts a role→actions map" test was removed: that map was
  // dead config — stored but never consumed by the authorizer — and is now rejected.
  // See "rejects an inline role→action access map" above.)
});
