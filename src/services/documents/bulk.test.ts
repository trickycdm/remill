/**
 * Bulk actions (D39): the loop rides the single-item services, so per-item
 * authorize/audit/events hold; mixed permissions produce partial results, and
 * completed items never roll back.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { eq } from 'drizzle-orm';
import { events } from '@/db/schema';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { listTrash } from '@/services/trash';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { BadRequestError } from '@/lib/errors';

const NOW = '2026-07-08T14:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

describe('bulkDocuments (D39)', () => {
  let db: Database;
  let admin: Principal;
  let author: Principal; // create/update own, NO publish, NO delete

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
  });

  async function seedDocs(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push((await docs.createDocument(db, admin, 'posts', { title: `Doc ${i}` }, NOW)).id);
    }
    return ids;
  }

  it('publishes, unpublishes, and trashes per item — with per-item events', async () => {
    const ids = await seedDocs(3);

    const pub = await docs.bulkDocuments(db, admin, 'posts', 'publish', ids, NOW);
    expect(pub).toMatchObject({ ok: 3, failed: 0 });
    for (const id of ids) {
      expect((await docs.getDocument(db, admin, 'posts', id, NOW)).status).toBe('published');
    }
    const published = await db.select().from(events).where(eq(events.type, 'document.published'));
    expect(published).toHaveLength(3); // one outbox event per item, in-batch

    const unpub = await docs.bulkDocuments(db, admin, 'posts', 'unpublish', ids.slice(0, 2), NOW);
    expect(unpub.ok).toBe(2);

    const trash = await docs.bulkDocuments(db, admin, 'posts', 'trash', ids, NOW);
    expect(trash).toMatchObject({ ok: 3, failed: 0 });
    const trashed = await listTrash(db, admin, {}, NOW);
    expect(trashed.rows.map((r) => r.documentId).sort()).toEqual([...ids].sort());
  });

  it('mixed permissions: an author cannot bulk-publish — partial result, no rollback', async () => {
    const mine = (await docs.createDocument(db, author, 'posts', { title: 'Mine' }, NOW)).id;
    const result = await docs.bulkDocuments(db, author, 'posts', 'publish', [mine], NOW);
    expect(result).toMatchObject({ ok: 0, failed: 1 });
    expect(result.errors[0].id).toBe(mine);

    // Mixed trash: author may delete NOTHING (no delete permission) while the
    // ids include a bogus one — every item reports, none throws the batch.
    const ids = await seedDocs(2);
    const mixed = await docs.bulkDocuments(db, author, 'posts', 'trash', [...ids, 'doc_missing'], NOW);
    expect(mixed.ok).toBe(0);
    expect(mixed.failed).toBe(3);

    // Admin trashing [good, bogus, good] completes the good ones (no rollback).
    const partial = await docs.bulkDocuments(db, admin, 'posts', 'trash', [ids[0], 'doc_missing', ids[1]], NOW);
    expect(partial).toMatchObject({ ok: 2, failed: 1 });
  });

  it('validates op, empty selection, and the 100-id cap', async () => {
    await expect(docs.bulkDocuments(db, admin, 'posts', 'explode' as docs.BulkOp, ['doc_x'], NOW)).rejects.toThrow(
      BadRequestError,
    );
    await expect(docs.bulkDocuments(db, admin, 'posts', 'trash', [], NOW)).rejects.toThrow(/at least one/i);
    const tooMany = Array.from({ length: docs.MAX_BULK_IDS + 1 }, (_, i) => `doc_${i}`);
    await expect(docs.bulkDocuments(db, admin, 'posts', 'trash', tooMany, NOW)).rejects.toThrow(/at most 100/i);
  });
});
