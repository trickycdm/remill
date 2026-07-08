/**
 * Discovery reads (D35): everything flows through the anonymous gated pipeline —
 * drafts, non-publicRead collections, and lifecycle:'none' collections never
 * surface in feed/sitemap/homepage data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { recentPublishedDocs, allPublishedDocs, publicOverview, publicCollections } from '@/services/discovery';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { NotFoundError } from '@/lib/errors';

const NOW = '2026-07-08T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true },
    { key: 'slug', type: 'slug', config: { from: 'title' }, index: true },
    { key: 'body', type: 'markdown' },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

// publicRead but NO lifecycle — records, not pages; must not surface.
const RECORDS: CollectionDefinition = {
  slug: 'records',
  name: 'Records',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { lifecycle: 'none' },
  access: { publicRead: true },
};

// lifecycle but PRIVATE — must not surface.
const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

describe('discovery service (D35)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    for (const def of [POSTS, RECORDS, NOTES]) {
      await collectionsService.createCollection(db, admin, def, NOW);
    }
  });

  async function makePost(title: string, publish: boolean, at = NOW) {
    const doc = await docs.createDocument(db, admin, 'posts', { title, body: `Body of ${title}` }, at);
    if (publish) await docs.setPublished(db, admin, 'posts', doc.id, true, at);
    return doc;
  }

  it('only publicRead + lifecycle collections are advertised', async () => {
    const defs = await publicCollections(db);
    expect(defs.map((d) => d.slug)).toEqual(['posts']);
  });

  it('feed: published only, newest publishedAt first, slug paths, excerpts', async () => {
    await makePost('Old', true, '2026-07-01T00:00:00Z');
    await makePost('New', true, '2026-07-08T00:00:00Z');
    await makePost('Draft only', false);
    await docs.createDocument(db, admin, 'notes', { title: 'Private note' }, NOW);

    const feed = await recentPublishedDocs(db, NOW);
    expect(feed.map((d) => d.title)).toEqual(['New', 'Old']);
    expect(feed[0].path).toBe('/posts/new');
    expect(feed[0].excerpt).toContain('Body of New');
    expect(feed.some((d) => d.title.includes('Draft'))).toBe(false);
    expect(feed.some((d) => d.title.includes('Private'))).toBe(false);
  });

  it('?collection narrowing 404s for private and lifecycle-none collections', async () => {
    await expect(recentPublishedDocs(db, NOW, { collection: 'notes' })).rejects.toThrow(NotFoundError);
    await expect(recentPublishedDocs(db, NOW, { collection: 'records' })).rejects.toThrow(NotFoundError);
    await expect(recentPublishedDocs(db, NOW, { collection: 'ghost' })).rejects.toThrow(NotFoundError);
    expect(await recentPublishedDocs(db, NOW, { collection: 'posts' })).toEqual([]);
  });

  it('sitemap source lists every published public doc; homepage groups per collection', async () => {
    await makePost('A', true);
    await makePost('B', true);
    await makePost('C', false);

    const all = await allPublishedDocs(db, NOW);
    expect(all).toHaveLength(2);

    const overview = await publicOverview(db, NOW);
    expect(overview).toHaveLength(1);
    expect(overview[0].def.slug).toBe('posts');
    expect(overview[0].docs).toHaveLength(2);
  });
});
