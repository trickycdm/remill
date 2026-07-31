/**
 * contentOverview (the /admin/c home summary) — counts per collection/status +
 * freshness, scoped by the caller's read permissions. The access-critical
 * property: counts and MAX(updated_at) are compiled IN-QUERY from the caller's
 * read filter, so a conditioned reader can never learn draft counts or draft
 * activity through the overview (D17).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { eq } from 'drizzle-orm';
import { auditLog } from '@/db/schema';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-04T12:00:00Z';
const LATER = '2026-07-05T09:00:00Z';
const LATEST = '2026-07-06T15:30:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

function itemFor(items: docs.ContentOverviewItem[], slug: string): docs.ContentOverviewItem {
  const item = items.find((i) => i.def.slug === slug);
  expect(item).toBeDefined();
  return item!;
}

describe('contentOverview — the /admin/c per-collection summary', () => {
  let db: Database;
  let admin: Principal;
  let reader: Principal;
  let author: Principal;
  let nobody: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    nobody = await makePrincipal(db, NOW, { id: 'prn_nobody' }); // no role at all
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    await collectionsService.createCollection(db, admin, NOTES, NOW);
  });

  it('counts per status and reports the newest visible update (admin)', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'Draft one' }, NOW);
    const live = await docs.createDocument(db, admin, 'posts', { title: 'Live one' }, NOW);
    await docs.setPublished(db, admin, 'posts', live.id, true, LATER);

    const items = await docs.contentOverview(db, admin, LATEST);
    const posts = itemFor(items, 'posts');
    expect(posts.counts).toEqual({ published: 1, draft: 1 });
    expect(posts.lastUpdatedAt).toBe(LATER);
    expect(posts.canCreate).toBe(true);
  });

  it('never leaks draft counts or draft freshness to a published-only reader', async () => {
    const draft = await docs.createDocument(db, admin, 'posts', { title: 'Secret draft' }, NOW);
    const live = await docs.createDocument(db, admin, 'posts', { title: 'Live' }, NOW);
    await docs.setPublished(db, admin, 'posts', live.id, true, NOW);
    // A draft-only edit later than any published activity...
    await docs.updateDocument(db, admin, 'posts', draft.id, { title: 'Still secret' }, LATEST);

    const items = await docs.contentOverview(db, reader, LATEST);
    const posts = itemFor(items, 'posts');
    expect(posts.counts).toEqual({ published: 1, draft: 0 });
    // ...must not surface through the freshness signal.
    expect(posts.lastUpdatedAt).toBe(NOW);
    expect(posts.canCreate).toBe(false);
  });

  it("an own-conditioned author counts their drafts, not anyone else's", async () => {
    await docs.createDocument(db, author, 'posts', { title: 'Mine' }, NOW);
    await docs.createDocument(db, admin, 'posts', { title: 'Not mine' }, NOW);

    const items = await docs.contentOverview(db, author, LATEST);
    const posts = itemFor(items, 'posts');
    expect(posts.counts).toEqual({ published: 0, draft: 1 });
    expect(posts.canCreate).toBe(true);
  });

  it('returns def-only items (no counts, no deny audit) for an unprivileged principal', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'Hidden' }, NOW);

    const items = await docs.contentOverview(db, nobody, LATEST);
    const posts = itemFor(items, 'posts');
    expect(posts.counts).toBeUndefined();
    expect(posts.lastUpdatedAt).toBeUndefined();
    expect(posts.canCreate).toBe(false);

    // The capability pre-check must not spray deny rows into the audit log.
    const denies = await db.select().from(auditLog).where(eq(auditLog.allowed, 0));
    expect(denies).toHaveLength(0);
  });

  it('reports zero counts (not absence) for an empty readable collection', async () => {
    const items = await docs.contentOverview(db, admin, LATEST);
    const notes = itemFor(items, 'notes');
    expect(notes.counts).toEqual({ published: 0, draft: 0 });
    expect(notes.lastUpdatedAt).toBeUndefined();
  });
});
