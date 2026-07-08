/**
 * Full-text search + filter operators (D28). Exercises the REAL FTS5 pipeline —
 * the test D1 (better-sqlite3) applies migration 0007, so document saves write
 * document_fts rows and MATCH/bm25/snippet run for real.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { searchSite, rebuildSearchIndex } from '@/services/search';
import { anonymousPrincipal, type Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';
import { BadRequestError } from '@/lib/errors';
import { SNIPPET_START } from '@/lib/fts';

const NOW = '2026-07-04T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'body', type: 'markdown' },
    { key: 'views', type: 'number', index: true },
  ],
  workflow: { draftPublish: true },
};

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } }],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

describe('searchSite — FTS5 search with in-query ACL (D28)', () => {
  let db: Database;
  let admin: Principal;
  let author: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    await collectionsService.createCollection(db, admin, NOTES, NOW);
  });

  it('finds documents by title and body text, marks snippets', async () => {
    const doc = await docs.createDocument(
      db,
      admin,
      'posts',
      { title: 'Zebra Migration', body: 'The **wildebeest** cross the Mara river.' },
      NOW,
    );
    const byTitle = await searchSite(db, admin, { q: 'zebra' }, NOW);
    expect(byTitle.hits.map((h) => h.id)).toEqual([doc.id]);
    expect(byTitle.hits[0].title).toBe('Zebra Migration');

    const byBody = await searchSite(db, admin, { q: 'wildebeest mara' }, NOW);
    expect(byBody.hits.map((h) => h.id)).toEqual([doc.id]);
    expect(byBody.hits[0].snippet).toContain(SNIPPET_START); // matches are marked
    expect(byBody.hits[0].snippet).not.toContain('**'); // markdown stripped
  });

  it('prefix-matches the final search word', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'Photosynthesis basics' }, NOW);
    const res = await searchSite(db, admin, { q: 'photosyn' }, NOW);
    expect(res.hits).toHaveLength(1);
  });

  it('stays in sync through update and delete', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Before rename' }, NOW);
    await docs.updateDocument(db, admin, 'posts', doc.id, { title: 'After rename' }, NOW);
    expect((await searchSite(db, admin, { q: 'before' }, NOW)).hits).toHaveLength(0);
    expect((await searchSite(db, admin, { q: 'after rename' }, NOW)).hits).toHaveLength(1);

    await docs.deleteDocument(db, admin, 'posts', doc.id, NOW);
    expect((await searchSite(db, admin, { q: 'after' }, NOW)).hits).toHaveLength(0);
  });

  it("applies the caller's compiled read filter in-query (author: own + published)", async () => {
    // Admin's private draft, admin's published post, author's own draft.
    await docs.createDocument(db, admin, 'posts', { title: 'Confidential launch plan' }, NOW);
    const pub = await docs.createDocument(db, admin, 'posts', { title: 'Public launch notes' }, NOW);
    await docs.setPublished(db, admin, 'posts', pub.id, true, NOW);
    const mine = await docs.createDocument(db, author, 'posts', { title: 'My launch diary' }, NOW);

    const res = await searchSite(db, author, { q: 'launch' }, NOW);
    expect(res.hits.map((h) => h.id).sort()).toEqual([pub.id, mine.id].sort());
  });

  it('anonymous readers search publicRead collections only, published only', async () => {
    const note = await docs.createDocument(db, admin, 'notes', { title: 'Shared knowledge' }, NOW);
    await docs.setPublished(db, admin, 'notes', note.id, true, NOW);
    await docs.createDocument(db, admin, 'notes', { title: 'Shared draft' }, NOW); // stays draft
    await docs.createDocument(db, admin, 'posts', { title: 'Shared internal post' }, NOW);

    const res = await searchSite(db, anonymousPrincipal('rest'), { q: 'shared' }, NOW);
    expect(res.hits.map((h) => h.id)).toEqual([note.id]);
  });

  it('restricts to one collection when asked (the MCP search_<slug> shape)', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'Everywhere echo' }, NOW);
    await docs.createDocument(db, admin, 'notes', { title: 'Everywhere echo too' }, NOW);
    const res = await searchSite(db, admin, { q: 'everywhere', collection: 'notes' }, NOW);
    expect(res.hits.every((h) => h.collection === 'notes')).toBe(true);
    expect(res.hits).toHaveLength(1);
  });

  it('returns nothing for an empty/whitespace query', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'Anything' }, NOW);
    expect((await searchSite(db, admin, { q: '   ' }, NOW)).hits).toHaveLength(0);
  });

  it('rebuildSearchIndex recomputes rows for pre-existing documents', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Rebuild target' }, NOW);
    // Simulate a pre-FTS document: wipe the virtual table out from under it.
    await db.run(`DELETE FROM document_fts` as never);
    expect((await searchSite(db, admin, { q: 'rebuild' }, NOW)).hits).toHaveLength(0);

    const count = await rebuildSearchIndex(db, admin, NOW);
    expect(count).toBeGreaterThanOrEqual(1);
    expect((await searchSite(db, admin, { q: 'rebuild' }, NOW)).hits.map((h) => h.id)).toEqual([doc.id]);
  });
});

describe('filter operators on list (D28)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    for (const [title, views] of [
      ['Alpha 100% done', 3],
      ['Beta effort', 10],
      ['Gamma effort', 20],
    ] as const) {
      await docs.createDocument(db, admin, 'posts', { title, body: 'x', views }, NOW);
    }
  });

  async function titlesFor(filters: docs.ListParams['filters']): Promise<string[]> {
    const res = await docs.listDocuments(db, admin, 'posts', { filters }, NOW);
    return res.rows.map((r) => String(r.data.title)).sort();
  }

  it('gte/lte compare numerically and compose into a range on one field', async () => {
    expect(await titlesFor({ views: { gte: '10' } })).toEqual(['Beta effort', 'Gamma effort']);
    expect(await titlesFor({ views: { gte: '5', lte: '15' } })).toEqual(['Beta effort']);
  });

  it('contains substring-matches text fields, with LIKE wildcards escaped', async () => {
    expect(await titlesFor({ title: { contains: 'effort' } })).toEqual(['Beta effort', 'Gamma effort']);
    // '%' is literal — matches "100% done", not everything.
    expect(await titlesFor({ title: { contains: '0%' } })).toEqual(['Alpha 100% done']);
  });

  it('in matches any of a comma-separated set', async () => {
    expect(await titlesFor({ views: { in: '3, 20' } })).toEqual(['Alpha 100% done', 'Gamma effort']);
  });

  it('plain string filters stay exact-match (back-compat)', async () => {
    expect(await titlesFor({ views: '10' })).toEqual(['Beta effort']);
  });

  it('rejects contains on numeric fields, unknown ops, and oversized in-sets', async () => {
    await expect(titlesFor({ views: { contains: '1' } })).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      titlesFor({ title: { like: 'x' } as unknown as Record<'eq', string> }),
    ).rejects.toBeInstanceOf(BadRequestError);
    const oversized = Array.from({ length: 21 }, (_, i) => String(i)).join(',');
    await expect(titlesFor({ views: { in: oversized } })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('still 400s on unindexed fields regardless of operator', async () => {
    await expect(titlesFor({ body: { contains: 'x' } })).rejects.toBeInstanceOf(BadRequestError);
  });
});
