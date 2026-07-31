/**
 * Import/export + snapshot (D37): export is bounded by the caller's compiled
 * read filter; import upserts by preserved id through the full validated
 * pipeline with per-line errors, a publish gate on 'published' lines, and a
 * write-free dry run; snapshot lands every collection + media metadata +
 * manifest under snapshots/<ISO>/ in R2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { exportCollection, importCollection, snapshotSite } from '@/services/transfer';
import { parseNdjson, toNdjson } from '@/lib/ndjson';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { BadRequestError, ForbiddenError } from '@/lib/errors';

const NOW = '2026-07-08T12:00:00Z';
const EARLIER = '2026-07-01T00:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
  ],
  workflow: { draftPublish: true },
};

describe('transfer (D37)', () => {
  let db: Database;
  let admin: Principal;
  let author: Principal; // create + read own/published + update own — NO publish

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
  });

  it('export: header + document lines, bounded by the compiled read filter', async () => {
    await docs.createDocument(db, author, 'posts', { title: 'Mine (draft)' }, NOW);
    const adminDraft = await docs.createDocument(db, admin, 'posts', { title: 'Admin draft' }, NOW);
    const pub = await docs.createDocument(db, admin, 'posts', { title: 'Published one' }, NOW);
    await docs.setPublished(db, admin, 'posts', pub.id, true, NOW);

    const asAuthor = await exportCollection(db, author, 'posts', NOW);
    const lines = parseNdjson(asAuthor.ndjson);
    const header = lines[0].value as { kind: string; version: number; collection: { slug: string } };
    expect(header.kind).toBe('remill-export');
    expect(header.version).toBe(1);
    expect(header.collection.slug).toBe('posts');

    // Author sees own draft + published — never the admin's draft.
    const titles = lines.slice(1).map((l) => (l.value as { data: { title: string } }).data.title);
    expect(titles.sort()).toEqual(['Mine (draft)', 'Published one']);
    expect(asAuthor.count).toBe(2);
    expect(titles).not.toContain('Admin draft');
    expect(adminDraft.id).toBeTruthy();

    const asAdmin = await exportCollection(db, admin, 'posts', NOW);
    expect(asAdmin.count).toBe(3);
  });

  it('round-trip: export → import into an empty collection preserves id/status/data/createdAt/publishedAt', async () => {
    const draft = await docs.createDocument(db, admin, 'posts', { title: 'Draft doc' }, EARLIER);
    const pub = await docs.createDocument(db, admin, 'posts', { title: 'Live doc' }, EARLIER);
    await docs.setPublished(db, admin, 'posts', pub.id, true, EARLIER);
    const { ndjson } = await exportCollection(db, admin, 'posts', NOW);

    // "Empty collection": a second collection with the same shape but its own slug
    // won't match the header — so rebuild the SAME collection empty instead.
    await docs.deleteDocument(db, admin, 'posts', draft.id, NOW);
    await docs.deleteDocument(db, admin, 'posts', pub.id, NOW);

    const result = await importCollection(db, admin, 'posts', ndjson, NOW);
    expect(result).toMatchObject({ created: 2, updated: 0, failed: 0, dryRun: false });

    const restoredPub = await docs.getDocument(db, admin, 'posts', pub.id, NOW);
    expect(restoredPub.status).toBe('published');
    expect(restoredPub.data.title).toBe('Live doc');
    expect(restoredPub.createdAt).toBe(EARLIER);
    expect(restoredPub.publishedAt).toBe(EARLIER);
    const restoredDraft = await docs.getDocument(db, admin, 'posts', draft.id, NOW);
    expect(restoredDraft.status).toBe('draft');
  });

  it('upsert: existing ids update (data merged through the validated pipeline)', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Original' }, NOW);
    const { ndjson } = await exportCollection(db, admin, 'posts', NOW);
    const edited = ndjson.replace('"Original"', '"Edited via import"');

    const result = await importCollection(db, admin, 'posts', edited, NOW);
    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const after = await docs.getDocument(db, admin, 'posts', doc.id, NOW);
    expect(after.data.title).toBe('Edited via import');
  });

  it('per-line errors never abort; dryRun writes nothing', async () => {
    const header = { kind: 'remill-export', version: 1, exportedAt: NOW, collection: POSTS };
    const text = toNdjson([
      header,
      { kind: 'document', data: { title: 'Good one' } },
      'not json at all',
      { kind: 'document', data: { title: 'Bad field', bogus: true } },
      { kind: 'document', id: 'not-a-doc-id', data: { title: 'Bad id' } },
      { kind: 'nonsense', data: {} },
    ]).replace('"not json at all"', 'not json at all');

    const dry = await importCollection(db, admin, 'posts', text, NOW, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.failed).toBeGreaterThanOrEqual(3);
    const noneWritten = await docs.listDocuments(db, admin, 'posts', {}, NOW);
    expect(noneWritten.total).toBe(0); // dry run wrote nothing

    const wet = await importCollection(db, admin, 'posts', text, NOW);
    expect(wet.created).toBe(1); // the good line
    expect(wet.failed).toBe(4);
    expect(wet.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(wet.errors[2].error).toMatch(/doc_/); // bad preserved-id shape
    const after = await docs.listDocuments(db, admin, 'posts', {}, NOW);
    expect(after.total).toBe(1);
  });

  it('rejects a header/def mismatch and a missing header', async () => {
    const other = { ...POSTS, slug: 'other' };
    const wrongTarget = toNdjson([
      { kind: 'remill-export', version: 1, exportedAt: NOW, collection: other },
      { kind: 'document', data: { title: 'x' } },
    ]);
    await expect(importCollection(db, admin, 'posts', wrongTarget, NOW)).rejects.toThrow(BadRequestError);
    await expect(importCollection(db, admin, 'posts', toNdjson([{ kind: 'document', data: {} }]), NOW)).rejects.toThrow(
      /header/i,
    );
    await expect(importCollection(db, admin, 'posts', '\n\n', NOW)).rejects.toThrow(/Empty import/);
  });

  it("import is not a publish bypass: an author's 'published' lines fail, drafts import", async () => {
    const text = toNdjson([
      { kind: 'remill-export', version: 1, exportedAt: NOW, collection: POSTS },
      { kind: 'document', status: 'published', data: { title: 'Sneaky live' } },
      { kind: 'document', data: { title: 'Honest draft' } },
    ]);
    const result = await importCollection(db, author, 'posts', text, NOW);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/publish/i);

    const list = await docs.listDocuments(db, admin, 'posts', {}, NOW);
    expect(list.total).toBe(1);
    expect(list.rows[0].status).toBe('draft');
  });

  it('unauthorized import is denied outright (create gate)', async () => {
    const reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    const text = toNdjson([
      { kind: 'remill-export', version: 1, exportedAt: NOW, collection: POSTS },
      { kind: 'document', data: { title: 'nope' } },
    ]);
    const result = await importCollection(db, reader, 'posts', text, NOW);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(1); // per-line create deny — reported, not thrown
  });

  it('snapshot writes per-collection NDJSON + media metadata + manifest under snapshots/<ISO>/', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'Snapped' }, NOW);
    const puts = new Map<string, string>();
    const bucket = {
      put: async (key: string, value: string) => {
        puts.set(key, value);
        return {};
      },
    } as unknown as R2Bucket;

    const result = await snapshotSite(db, bucket, admin, NOW);
    expect(result.prefix).toBe(`snapshots/${NOW}`);
    expect(puts.has(`snapshots/${NOW}/posts.ndjson`)).toBe(true);
    expect(puts.has(`snapshots/${NOW}/media.ndjson`)).toBe(true);
    const manifest = JSON.parse(puts.get(`snapshots/${NOW}/manifest.json`)!);
    expect(manifest.kind).toBe('remill-snapshot');
    expect(manifest.collections.find((c: { slug: string }) => c.slug === 'posts')?.documents).toBe(1);
    expect(manifest.note).toMatch(/binaries are excluded/i);

    // Not an operator → denied before any R2 write.
    await expect(snapshotSite(db, {} as R2Bucket, author, NOW)).rejects.toThrow(ForbiddenError);
  });
});
