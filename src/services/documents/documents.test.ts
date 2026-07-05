import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { eq } from 'drizzle-orm';
import { documentIndex } from '@/db/schema';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import type { Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';
import { InputValidationError, ConflictError, ForbiddenError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    { key: 'body', type: 'markdown' },
    { key: 'tags', type: 'tags', index: true },
    { key: 'views', type: 'number', index: true },
  ],
  workflow: { draftPublish: true },
};

async function indexRows(db: Database, documentId: string) {
  return db.select().from(documentIndex).where(eq(documentIndex.documentId, documentId));
}

describe('documents service — the save pipeline', () => {
  let db: Database;
  let admin: Principal;
  let nobody: Principal; // a principal with no role — should be denied

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    nobody = await makePrincipal(db, NOW, { id: 'prn_nobody' }); // no role assignment
    await collectionsService.createCollection(db, admin, POSTS, NOW);
  });

  it('creates a document, derives the slug, defaults to draft, appends revision 1', async () => {
    const doc = await docs.createDocument(
      db,
      admin,
      'posts',
      { title: 'Hello World', body: '# Hi', tags: 'a, b', views: 3 },
      NOW,
    );
    expect(doc.id).toMatch(/^doc_/);
    expect(doc.status).toBe('draft');
    expect(doc.data.title).toBe('Hello World');
    expect(doc.data.slug).toBe('hello-world'); // slug beforeSave derived + slugified
    expect(doc.data.tags).toEqual(['a', 'b']); // tags normalized from CSV
    expect(doc.createdBy).toBe(admin.id);

    const revs = await docs.listRevisions(db, admin, 'posts', doc.id, NOW);
    expect(revs).toHaveLength(1);
    expect(revs[0].revision).toBe(1);
  });

  it('syncs document_index rows for every indexed field', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Indexed Post', views: 42 }, NOW);
    const rows = await indexRows(db, doc.id);
    const byField = Object.fromEntries(rows.map((r) => [r.fieldKey, r]));
    expect(byField.title?.valueText).toBe('Indexed Post');
    expect(byField.slug?.valueText).toBe('indexed-post');
    expect(byField.views?.valueNum).toBe(42);
    expect(byField.body).toBeUndefined(); // body is not indexed
  });

  it('WHITELIST: rejects any undeclared field (anti-mass-assignment)', async () => {
    await expect(
      docs.createDocument(db, admin, 'posts', { title: 'X', isAdmin: true, __proto__: {} }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('WHITELIST property: no undeclared key ever survives, for arbitrary junk', async () => {
    const junkKeys = ['role', 'createdBy', 'status', 'id', 'password', 'x', 'owner', 'published'];
    for (const k of junkKeys) {
      await expect(
        docs.createDocument(db, admin, 'posts', { title: 'ok', [k]: 'pwn' }, NOW),
      ).rejects.toBeInstanceOf(InputValidationError);
    }
  });

  it('validates declared fields (missing required title rejected)', async () => {
    await expect(docs.createDocument(db, admin, 'posts', { body: 'no title' }, NOW)).rejects.toBeInstanceOf(
      InputValidationError,
    );
  });

  it('enforces unique fields (duplicate slug rejected)', async () => {
    await docs.createDocument(db, admin, 'posts', { title: 'Same Title' }, NOW);
    await expect(docs.createDocument(db, admin, 'posts', { title: 'Same Title' }, NOW)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('updates a document, appends a revision, re-syncs the index', async () => {
    const created = await docs.createDocument(db, admin, 'posts', { title: 'First', views: 1 }, NOW);
    const updated = await docs.updateDocument(db, admin, 'posts', created.id, { views: 99 }, NOW);
    expect(updated.data.views).toBe(99);
    expect(updated.data.title).toBe('First'); // merge preserved untouched fields

    const revs = await docs.listRevisions(db, admin, 'posts', created.id, NOW);
    expect(revs.map((r) => r.revision)).toEqual([2, 1]);

    const rows = await indexRows(db, created.id);
    expect(rows.find((r) => r.fieldKey === 'views')?.valueNum).toBe(99);
  });

  it('publishes and unpublishes, setting publishedAt', async () => {
    const created = await docs.createDocument(db, admin, 'posts', { title: 'Publish Me' }, NOW);
    expect(created.status).toBe('draft');
    const published = await docs.setPublished(db, admin, 'posts', created.id, true, NOW);
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe(NOW);
    const unpublished = await docs.setPublished(db, admin, 'posts', created.id, false, NOW);
    expect(unpublished.status).toBe('draft');
    expect(unpublished.publishedAt).toBeNull();
  });

  it('restores a prior revision as a new save', async () => {
    const created = await docs.createDocument(db, admin, 'posts', { title: 'V1', views: 1 }, NOW);
    await docs.updateDocument(db, admin, 'posts', created.id, { views: 2 }, NOW);
    const restored = await docs.restoreRevision(db, admin, 'posts', created.id, 1, NOW);
    expect(restored.data.views).toBe(1);
    const revs = await docs.listRevisions(db, admin, 'posts', created.id, NOW);
    expect(revs).toHaveLength(3); // create, update, restore — history is append-only
  });

  it('denies a principal with no role (default deny)', async () => {
    await expect(docs.createDocument(db, nobody, 'posts', { title: 'nope' }, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('lists documents with pagination and total', async () => {
    for (let i = 0; i < 3; i++) await docs.createDocument(db, admin, 'posts', { title: `Post ${i}` }, NOW);
    const page = await docs.listDocuments(db, admin, 'posts', { page: 1, pageSize: 2 }, NOW);
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(2);
  });
});
