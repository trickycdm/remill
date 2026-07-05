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

  it('COR-7: keyset cursor pagination walks all rows without overlap and keeps the full total', async () => {
    for (let i = 0; i < 5; i++) await docs.createDocument(db, admin, 'posts', { title: `Cur ${i}` }, NOW);

    const p1 = await docs.listDocuments(db, admin, 'posts', { pageSize: 2 }, NOW);
    expect(p1.rows).toHaveLength(2);
    expect(p1.total).toBe(5); // total is the full filtered set (D17), not the page
    expect(p1.nextCursor).toBeDefined();

    const p2 = await docs.listDocuments(db, admin, 'posts', { pageSize: 2, cursor: p1.nextCursor }, NOW);
    expect(p2.rows).toHaveLength(2);
    expect(p2.total).toBe(5); // count unchanged by the cursor

    const p3 = await docs.listDocuments(db, admin, 'posts', { pageSize: 2, cursor: p2.nextCursor }, NOW);
    expect(p3.rows).toHaveLength(1);
    expect(p3.nextCursor).toBeUndefined(); // last page

    const ids = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(5); // every row seen exactly once
  });
});

// ---------------------------------------------------------------------------
// COR-3 — numeric/boolean filter & sort read the correct index column.
// ---------------------------------------------------------------------------

const METRICS: CollectionDefinition = {
  slug: 'metrics',
  name: 'Metrics',
  shape: 'collection',
  fields: [
    { key: 'label', type: 'text', required: true, index: true },
    { key: 'score', type: 'number', index: true },
    { key: 'active', type: 'boolean', index: true },
  ],
};

describe('documents service — numeric/boolean filter & sort (COR-3)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, METRICS, NOW);
    await docs.createDocument(db, admin, 'metrics', { label: 'low', score: 5, active: false }, NOW);
    await docs.createDocument(db, admin, 'metrics', { label: 'mid', score: 30, active: true }, NOW);
    await docs.createDocument(db, admin, 'metrics', { label: 'high', score: 100, active: true }, NOW);
  });

  it('filters a number field against value_num (was silently matching nothing)', async () => {
    const res = await docs.listDocuments(db, admin, 'metrics', { filters: { score: '30' } }, NOW);
    expect(res.total).toBe(1);
    expect(res.rows[0].data.label).toBe('mid');
  });

  it('filters a boolean field (true and false)', async () => {
    const on = await docs.listDocuments(db, admin, 'metrics', { filters: { active: 'true' } }, NOW);
    expect(on.total).toBe(2);
    expect(on.rows.map((r) => r.data.label).sort()).toEqual(['high', 'mid']);

    const off = await docs.listDocuments(db, admin, 'metrics', { filters: { active: 'false' } }, NOW);
    expect(off.total).toBe(1);
    expect(off.rows[0].data.label).toBe('low');
  });

  it('sorts a number field in NUMERIC order (not lexicographic), asc and desc', async () => {
    const asc = await docs.listDocuments(db, admin, 'metrics', { sort: { field: 'score', dir: 'asc' } }, NOW);
    expect(asc.rows.map((r) => r.data.score)).toEqual([5, 30, 100]);

    const desc = await docs.listDocuments(db, admin, 'metrics', { sort: { field: 'score', dir: 'desc' } }, NOW);
    expect(desc.rows.map((r) => r.data.score)).toEqual([100, 30, 5]);
  });
});

// ---------------------------------------------------------------------------
// COR-8 — unique enforcement, including numeric fields + the DB-level backstop.
// ---------------------------------------------------------------------------

const CATALOG: CollectionDefinition = {
  slug: 'catalog',
  name: 'Catalog',
  shape: 'collection',
  fields: [
    { key: 'name', type: 'text', required: true, index: true },
    { key: 'sku', type: 'number', unique: true, index: true },
  ],
};

describe('documents service — unique enforcement incl. numeric (COR-8)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, CATALOG, NOW);
  });

  it('rejects a duplicate numeric unique on CREATE', async () => {
    await docs.createDocument(db, admin, 'catalog', { name: 'A', sku: 100 }, NOW);
    await expect(
      docs.createDocument(db, admin, 'catalog', { name: 'B', sku: 100 }, NOW),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a duplicate numeric unique on UPDATE', async () => {
    await docs.createDocument(db, admin, 'catalog', { name: 'A', sku: 100 }, NOW);
    const b = await docs.createDocument(db, admin, 'catalog', { name: 'B', sku: 200 }, NOW);
    await expect(
      docs.updateDocument(db, admin, 'catalog', b.id, { sku: 100 }, NOW),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows updating a row without colliding with its OWN unique value (excludeId)', async () => {
    const a = await docs.createDocument(db, admin, 'catalog', { name: 'A', sku: 100 }, NOW);
    const updated = await docs.updateDocument(db, admin, 'catalog', a.id, { name: 'A2' }, NOW);
    expect(updated.data.name).toBe('A2');
    expect(updated.data.sku).toBe(100);
  });

  it('the DB unique index is the race-proof backstop: a raw duplicate index row is rejected', async () => {
    const a = await docs.createDocument(db, admin, 'catalog', { name: 'A', sku: 100 }, NOW);
    // Inserting a second document_index row with the same (unique_key, value_num)
    // must be rejected — no other constraint could reject this row (FK satisfied,
    // id/NOT NULL fine), so the throw proves the partial unique index is the
    // race-proof backstop behind the app-level pre-check.
    await expect(
      db.insert(documentIndex).values({
        id: 'idx_dup_race',
        documentId: a.id,
        collection: 'catalog',
        fieldKey: 'sku',
        valueText: null,
        valueNum: 100,
        uniqueKey: 'catalog:sku',
      }),
    ).rejects.toThrow();
    // The duplicate never persisted — still exactly one sku index row.
    const rows = await indexRows(db, a.id);
    expect(rows.filter((r) => r.fieldKey === 'sku')).toHaveLength(1);
  });

  it('non-unique indexed fields may repeat freely (unique_key NULL → NULLs distinct)', async () => {
    // `name` is indexed but NOT unique; two docs may share it.
    await docs.createDocument(db, admin, 'catalog', { name: 'Same', sku: 1 }, NOW);
    await expect(
      docs.createDocument(db, admin, 'catalog', { name: 'Same', sku: 2 }, NOW),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// COR-5 — a document stays saveable after a field is removed from the schema.
// ---------------------------------------------------------------------------

describe('documents service — save after schema change (COR-5)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
  });

  it('a document carrying data from a since-removed field can still be saved', async () => {
    const withLegacy: CollectionDefinition = {
      slug: 'notes',
      name: 'Notes',
      shape: 'collection',
      fields: [
        { key: 'title', type: 'text', required: true, index: true },
        { key: 'legacy', type: 'text' },
      ],
    };
    await collectionsService.createCollection(db, admin, withLegacy, NOW);
    const doc = await docs.createDocument(db, admin, 'notes', { title: 'T', legacy: 'old' }, NOW);
    expect(doc.data.legacy).toBe('old');

    // Remove `legacy` from the schema.
    await collectionsService.updateCollection(
      db,
      admin,
      'notes',
      { ...withLegacy, fields: [{ key: 'title', type: 'text', required: true, index: true }] },
      NOW,
    );

    // Before the fix, the stale `legacy` key made the merged doc fail the whitelist
    // and the doc could never be saved again. Now it saves; the stale value drops.
    const updated = await docs.updateDocument(db, admin, 'notes', doc.id, { title: 'T2' }, NOW);
    expect(updated.data.title).toBe('T2');
    expect(updated.data.legacy).toBeUndefined();
  });
});
