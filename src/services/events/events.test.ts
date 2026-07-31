/**
 * Events outbox (D33): every mutation emits exactly ONE pointer event inside
 * its atomic batch; seq is monotonic; polling is since-cursored and filtered
 * to collections the caller can read (roles ∩ token scope, plus publicRead).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { events } from '@/db/schema';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import * as trash from '@/services/trash';
import { uploadMedia, deleteMedia } from '@/services/media';
import { pollEvents, pruneEvents } from '@/services/events';
import { anonymousPrincipal, type Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-08T12:00:00Z';

// A valid 1×1 transparent PNG (real magic bytes for sniffMime).
const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (ch) => ch.charCodeAt(0),
);

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

const PAGES: CollectionDefinition = {
  slug: 'pages',
  name: 'Pages',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

const fakeBucket = { put: async () => ({}), delete: async () => {} } as unknown as R2Bucket;

describe('events outbox (D33)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
  });

  async function allEvents() {
    return db.select().from(events).orderBy(events.seq);
  }

  it('every mutation type emits exactly one in-batch event; seq is monotonic', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'v1' }, NOW);
    await docs.updateDocument(db, admin, 'posts', doc.id, { title: 'v2' }, NOW);
    await docs.setPublished(db, admin, 'posts', doc.id, true, NOW);
    await docs.setPublished(db, admin, 'posts', doc.id, false, NOW);
    await docs.deleteDocument(db, admin, 'posts', doc.id, NOW);
    const trashed = await trash.listTrash(db, admin, {}, NOW);
    await trash.restoreDocument(db, admin, trashed.rows[0].id, NOW);

    const med = await uploadMedia(db, fakeBucket, admin, { filename: 'x.png', bytes: TINY_PNG, alt: 'dot' }, NOW);
    await deleteMedia(db, fakeBucket, admin, med.id, NOW);

    await collectionsService.createCollection(db, admin, PAGES, NOW);
    await collectionsService.updateCollection(db, admin, 'pages', { ...PAGES, name: 'Pages!' }, NOW);
    await collectionsService.deleteCollection(db, admin, 'pages', NOW);

    const rows = await allEvents();
    expect(rows.map((r) => r.type)).toEqual([
      'collection.created', // posts (beforeEach)
      'document.created',
      'document.updated',
      'document.published',
      'document.unpublished',
      'document.deleted',
      'document.restored',
      'media.created',
      'media.deleted',
      'collection.created', // pages
      'collection.updated',
      'collection.deleted',
    ]);
    // Monotonic, never reused.
    const seqs = rows.map((r) => r.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    // Pointers only: resource ids, actor attribution.
    const created = rows.find((r) => r.type === 'document.created')!;
    expect(created.resource).toBe(doc.id);
    expect(created.principalId).toBe(admin.id);
    expect(created.collection).toBe('posts');
  });

  it('since-cursor is exact; nextSince echoes since when nothing is new', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'a' }, NOW);
    await docs.createDocument(db, admin, 'posts', { title: 'b' }, NOW);

    const first = await pollEvents(db, admin, {});
    expect(first.data.length).toBeGreaterThan(0);
    const again = await pollEvents(db, admin, { since: first.nextSince });
    expect(again.data).toEqual([]);
    expect(again.nextSince).toBe(first.nextSince);

    await docs.createDocument(db, admin, 'posts', { title: 'c' }, NOW);
    const delta = await pollEvents(db, admin, { since: first.nextSince });
    expect(delta.data).toHaveLength(1);
    expect(delta.data[0].type).toBe('document.created');
  });

  it('filters to readable collections: scoped role, token mask, publicRead, anonymous', async () => {
    await collectionsService.createCollection(db, admin, PAGES, NOW); // publicRead
    const secret: CollectionDefinition = { ...POSTS, slug: 'secret', name: 'Secret' };
    await collectionsService.createCollection(db, admin, secret, NOW);
    await docs.createDocument(db, admin, 'posts', { title: 'p' }, NOW);
    await docs.createDocument(db, admin, 'pages', { title: 'g' }, NOW);
    await docs.createDocument(db, admin, 'secret', { title: 's' }, NOW);

    // Reader role scoped to ONE collection sees that collection + publicRead.
    const scopedReader = await makePrincipal(db, NOW, { id: 'prn_scoped', role: 'reader', collection: 'posts' });
    const scoped = await pollEvents(db, scopedReader, {});
    const scopedCollections = new Set(scoped.data.map((e) => e.collection));
    expect(scopedCollections.has('posts')).toBe(true);
    expect(scopedCollections.has('pages')).toBe(true); // publicRead union
    expect(scopedCollections.has('secret')).toBe(false);

    // A wildcard role behind a narrowing token mask is cut to the mask —
    // including the publicRead union (the mask never widens).
    const maskedAgent = await makePrincipal(db, NOW, {
      id: 'prn_masked',
      kind: 'agent',
      role: 'editor',
      surface: 'mcp',
      tokenScope: [{ collection: 'posts', action: 'read' }],
    });
    const masked = await pollEvents(db, maskedAgent, {});
    expect(new Set(masked.data.map((e) => e.collection))).toEqual(new Set(['posts']));

    // Anonymous sees ONLY publicRead collections' events.
    const anon = await pollEvents(db, anonymousPrincipal('rest'), {});
    expect(new Set(anon.data.map((e) => e.collection))).toEqual(new Set(['pages']));

    // Narrowing to an unreadable collection: empty, indistinguishable from quiet.
    const narrowed = await pollEvents(db, scopedReader, { collection: 'secret' });
    expect(narrowed.data).toEqual([]);

    // Admin wildcard sees everything.
    const all = await pollEvents(db, admin, {});
    expect(new Set(all.data.map((e) => e.collection))).toEqual(new Set(['posts', 'pages', 'secret']));
  });

  it('rejects a bad since; clamps limit', async () => {
    await expect(pollEvents(db, admin, { since: -1 })).rejects.toThrow(/non-negative/);
    await expect(pollEvents(db, admin, { since: 1.5 })).rejects.toThrow(/non-negative/);
    for (let i = 0; i < 4; i++) await docs.createDocument(db, admin, 'posts', { title: `t${i}` }, NOW);
    const page = await pollEvents(db, admin, { limit: 2 });
    expect(page.data).toHaveLength(2);
    const next = await pollEvents(db, admin, { since: page.nextSince, limit: 500 });
    expect(next.data.length).toBeGreaterThan(0); // continues exactly after the page
  });

  it('prune honors the 30-day cutoff and leaves newer rows (gaps are legal)', async () => {
    const OLD = '2026-06-01T00:00:00Z'; // > 30 days before NOW
    await docs.createDocument(db, admin, 'posts', { title: 'old' }, OLD);
    await docs.createDocument(db, admin, 'posts', { title: 'new' }, NOW);
    const before = await allEvents();
    const pruned = await pruneEvents(db, NOW);
    // The posts collection.created (beforeEach, NOW) and the 'new' doc stay.
    expect(pruned).toBe(1);
    const after = await allEvents();
    expect(after.length).toBe(before.length - 1);
    expect(after.some((e) => e.createdAt === OLD)).toBe(false);
    // Surviving seqs are unchanged — the cursor keeps meaning across prunes.
    expect(after.every((e) => before.some((b) => b.seq === e.seq && b.type === e.type))).toBe(true);
  });
});
