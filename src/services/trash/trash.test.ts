/**
 * Recoverable delete (D29): snapshot-then-delete, restore under the original id,
 * condition-scoped listing, and retention purge. Runs against the real migrated
 * test D1 (including the FTS table), so cascade + search-sync claims are exercised
 * for real.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { eq } from 'drizzle-orm';
import { documentIndex, documentRevisions } from '@/db/schema';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { listTrash, restoreDocument, deleteForever, purgeExpiredTrash } from '@/services/trash';
import { createRole } from '@/services/access';
import { searchSite } from '@/services/search';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { NotFoundError, ConflictError, ForbiddenError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';
const LATER = '2026-07-05T12:00:00Z';
const AFTER_RETENTION = '2026-08-10T12:00:00Z'; // > 30 days past NOW

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    { key: 'body', type: 'markdown' },
  ],
  workflow: { draftPublish: true },
};

describe('trash — snapshot-then-delete + restore (D29)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
  });

  async function makePost(title: string, by: Principal = admin) {
    return docs.createDocument(db, by, 'posts', { title, body: `Body of ${title}` }, NOW);
  }

  it('delete snapshots the doc + revisions, then clears doc/index/revisions/FTS', async () => {
    const doc = await makePost('Doomed post');
    await docs.updateDocument(db, admin, 'posts', doc.id, { title: 'Doomed post v2' }, NOW); // rev 2

    await docs.deleteDocument(db, admin, 'posts', doc.id, LATER);

    // Original gone everywhere.
    await expect(docs.getDocument(db, admin, 'posts', doc.id, LATER)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(documentIndex).where(eq(documentIndex.documentId, doc.id))).toHaveLength(0);
    expect(await db.select().from(documentRevisions).where(eq(documentRevisions.documentId, doc.id))).toHaveLength(0);
    expect((await searchSite(db, admin, { q: 'doomed' }, LATER)).hits).toHaveLength(0);

    // Snapshot complete: data + both revisions, attribution, timestamps.
    const { rows } = await listTrash(db, admin, {}, LATER);
    expect(rows).toHaveLength(1);
    expect(rows[0].documentId).toBe(doc.id);
    expect(rows[0].data.title).toBe('Doomed post v2');
    expect(rows[0].revisions.map((r) => r.revision)).toEqual([2, 1]);
    expect(rows[0].deletedBy).toBe(admin.id);
    expect(rows[0].deletedAt).toBe(LATER);
  });

  it('restore brings the doc back under the ORIGINAL id — index, FTS, and history included', async () => {
    const doc = await makePost('Phoenix');
    await docs.updateDocument(db, admin, 'posts', doc.id, { title: 'Phoenix reborn' }, NOW);
    await docs.deleteDocument(db, admin, 'posts', doc.id, LATER);
    const { rows } = await listTrash(db, admin, {}, LATER);

    const restored = await restoreDocument(db, admin, rows[0].id, LATER);
    expect(restored.documentId).toBe(doc.id); // relations by id resume

    const back = await docs.getDocument(db, admin, 'posts', doc.id, LATER);
    expect(back.data.title).toBe('Phoenix reborn');
    // Index rebuilt → filterable again; FTS rebuilt → searchable again.
    const filtered = await docs.listDocuments(db, admin, 'posts', { filters: { slug: 'phoenix' } }, LATER);
    expect(filtered.rows.map((r) => r.id)).toEqual([doc.id]);
    expect((await searchSite(db, admin, { q: 'phoenix' }, LATER)).hits.map((h) => h.id)).toEqual([doc.id]);
    // Revision history restored.
    const revs = await docs.listRevisions(db, admin, 'posts', doc.id, LATER);
    expect(revs.map((r) => r.revision)).toEqual([2, 1]);
    // Trash entry consumed.
    expect((await listTrash(db, admin, {}, LATER)).rows).toHaveLength(0);
    await expect(restoreDocument(db, admin, rows[0].id, LATER)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('409s when a unique value was re-taken since deletion', async () => {
    const doc = await makePost('Same Slug');
    await docs.deleteDocument(db, admin, 'posts', doc.id, LATER);
    await makePost('Same Slug'); // re-takes slug 'same-slug'
    const { rows } = await listTrash(db, admin, {}, LATER);
    await expect(restoreDocument(db, admin, rows[0].id, LATER)).rejects.toBeInstanceOf(ConflictError);
  });

  it('409s when the collection definition is gone', async () => {
    const doc = await makePost('Orphan');
    await docs.deleteDocument(db, admin, 'posts', doc.id, LATER);
    const { rows } = await listTrash(db, admin, {}, LATER);
    await collectionsService.deleteCollection(db, admin, 'posts', LATER);
    // The snapshot survives the collection delete (no FK)…
    await expect(restoreDocument(db, admin, rows[0].id, LATER)).rejects.toBeInstanceOf(ConflictError);
  });

  it('delete forever removes the entry without restoring', async () => {
    const doc = await makePost('Gone for good');
    await docs.deleteDocument(db, admin, 'posts', doc.id, LATER);
    const { rows } = await listTrash(db, admin, {}, LATER);
    await deleteForever(db, admin, rows[0].id, LATER);
    expect((await listTrash(db, admin, {}, LATER)).rows).toHaveLength(0);
    await expect(docs.getDocument(db, admin, 'posts', doc.id, LATER)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the daily purge honors the 30-day retention window', async () => {
    const doc = await makePost('Old rubbish');
    await docs.deleteDocument(db, admin, 'posts', doc.id, LATER);
    expect(await purgeExpiredTrash(db, LATER)).toBe(0); // same day — kept
    expect(await purgeExpiredTrash(db, AFTER_RETENTION)).toBe(1); // 36 days on — purged
    expect((await listTrash(db, admin, {}, AFTER_RETENTION)).rows).toHaveLength(0);
  });

  it("an own-conditioned deleter sees and restores ONLY their own trash", async () => {
    await createRole(
      db,
      admin,
      {
        slug: 'cleaner',
        name: 'Cleaner',
        description: 'Deletes own posts only (own-conditioned delete).',
        permissions: [
          { collection: 'posts', action: 'create' },
          { collection: 'posts', action: 'read', condition: 'own' },
          { collection: 'posts', action: 'delete', condition: 'own' },
        ],
      },
      NOW,
    );
    const cleaner = await makePrincipal(db, NOW, { id: 'prn_cleaner', role: 'cleaner' });

    const mine = await makePost('Cleaner private note', cleaner);
    const theirs = await makePost('Admin private note');
    await docs.deleteDocument(db, cleaner, 'posts', mine.id, LATER);
    await docs.deleteDocument(db, admin, 'posts', theirs.id, LATER);

    // Listing is condition-scoped in-query: only the cleaner's own entry.
    const visible = await listTrash(db, cleaner, {}, LATER);
    expect(visible.rows.map((r) => r.documentId)).toEqual([mine.id]);

    // Restoring someone else's entry is denied at the ITEM decision.
    const all = await listTrash(db, admin, {}, LATER);
    const theirsEntry = all.rows.find((r) => r.documentId === theirs.id)!;
    await expect(restoreDocument(db, cleaner, theirsEntry.id, LATER)).rejects.toBeInstanceOf(ForbiddenError);

    // Their own restores fine.
    const mineEntry = visible.rows[0];
    await expect(restoreDocument(db, cleaner, mineEntry.id, LATER)).resolves.toMatchObject({
      documentId: mine.id,
    });
  });

  it('a principal with no delete permission sees an empty trash and cannot act', async () => {
    const doc = await makePost('Reader bait');
    await docs.deleteDocument(db, admin, 'posts', doc.id, LATER);
    const reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    expect((await listTrash(db, reader, {}, LATER)).rows).toHaveLength(0);
    const { rows } = await listTrash(db, admin, {}, LATER);
    await expect(restoreDocument(db, reader, rows[0].id, LATER)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
