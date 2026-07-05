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
import { InputValidationError, ConflictError, ForbiddenError, NotFoundError, BadRequestError } from '@/lib/errors';

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

  it('multi-valued relation: one document_index row per referenced id; re-synced on update (B1)', async () => {
    const PEOPLE: CollectionDefinition = {
      slug: 'people',
      name: 'People',
      shape: 'collection',
      fields: [
        { key: 'name', type: 'text', required: true, index: true },
        { key: 'posts', type: 'relation', config: { collection: 'posts', multiple: true }, index: true },
      ],
    };
    await collectionsService.createCollection(db, admin, PEOPLE, NOW);

    const person = await docs.createDocument(
      db,
      admin,
      'people',
      { name: 'Ada', posts: ['doc_a1', 'doc_b2', 'doc_c3'] },
      NOW,
    );
    const edges = (await indexRows(db, person.id)).filter((r) => r.fieldKey === 'posts');
    expect(edges.map((r) => r.valueText).sort()).toEqual(['doc_a1', 'doc_b2', 'doc_c3']);
    expect(edges.every((r) => r.uniqueKey === null)).toBe(true);

    // The comma-string widget shape normalizes + dedupes; scalars elsewhere unaffected.
    const bob = await docs.createDocument(db, admin, 'people', { name: 'Bob', posts: 'doc_b2, doc_b2, doc_z9' }, NOW);
    expect(bob.data.posts).toEqual(['doc_b2', 'doc_z9']);

    // Filtering matches ANY element (contains semantics) — both reference doc_b2.
    const hits = await docs.listDocuments(db, admin, 'people', { filters: { posts: 'doc_b2' } }, NOW);
    expect(hits.rows.map((r) => r.data.name).sort()).toEqual(['Ada', 'Bob']);

    // Update replaces the whole edge set (delete-then-insert sync).
    await docs.updateDocument(db, admin, 'people', person.id, { posts: ['doc_z9'] }, NOW);
    const after = (await indexRows(db, person.id)).filter((r) => r.fieldKey === 'posts');
    expect(after.map((r) => r.valueText)).toEqual(['doc_z9']);
  });

  it('B2: read-expansion resolves {id, title, collection} — single, multi, dangling', async () => {
    const AUTHORS: CollectionDefinition = {
      slug: 'authors',
      name: 'Authors',
      shape: 'collection',
      fields: [{ key: 'name', type: 'text', required: true, index: true }],
    };
    const BOOKS: CollectionDefinition = {
      slug: 'books',
      name: 'Books',
      shape: 'collection',
      fields: [
        { key: 'title', type: 'text', required: true, index: true },
        { key: 'author', type: 'relation', config: { collection: 'authors' } },
        { key: 'related', type: 'relation', config: { collection: 'books', multiple: true }, index: true },
      ],
    };
    await collectionsService.createCollection(db, admin, AUTHORS, NOW);
    await collectionsService.createCollection(db, admin, BOOKS, NOW);
    const ada = await docs.createDocument(db, admin, 'authors', { name: 'Ada Lovelace' }, NOW);
    const first = await docs.createDocument(db, admin, 'books', { title: 'Notes', author: ada.id }, NOW);
    const sequel = await docs.createDocument(
      db,
      admin,
      'books',
      { title: 'Sequel', author: ada.id, related: [first.id, 'doc_gone'] },
      NOW,
    );

    const read = await docs.getDocument(db, admin, 'books', sequel.id, NOW);
    expect(read.relations?.author).toEqual({ id: ada.id, title: 'Ada Lovelace', collection: 'authors' });
    expect(read.relations?.related).toEqual([
      { id: first.id, title: 'Notes', collection: 'books' },
      { id: 'doc_gone', title: null, collection: 'books' }, // dangling → graceful null
    ]);
    // data keeps the RAW ids — the write round-trip shape is untouched.
    expect(read.data.author).toBe(ada.id);
    expect(read.data.related).toEqual([first.id, 'doc_gone']);

    const listed = await docs.listDocuments(db, admin, 'books', {}, NOW);
    const row = listed.rows.find((r) => r.id === sequel.id);
    expect(row?.relations?.author).toEqual({ id: ada.id, title: 'Ada Lovelace', collection: 'authors' });
  });

  it("B4: lifecycle 'none' — docs born published; publish/unpublish rejected", async () => {
    const RECORDS: CollectionDefinition = {
      slug: 'companies',
      name: 'Companies',
      shape: 'collection',
      fields: [{ key: 'name', type: 'text', required: true, index: true }],
      workflow: { lifecycle: 'none' },
    };
    await collectionsService.createCollection(db, admin, RECORDS, NOW);
    const doc = await docs.createDocument(db, admin, 'companies', { name: 'ACME' }, NOW);
    expect(doc.status).toBe('published'); // born published — no draft state exists

    await expect(
      docs.setPublished(db, admin, 'companies', doc.id, false, NOW),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('B3: backlinks — A referencing B appears under B, access-scoped, indexed-only', async () => {
    const AUTHORS: CollectionDefinition = {
      slug: 'authors',
      name: 'Authors',
      shape: 'collection',
      fields: [{ key: 'name', type: 'text', required: true, index: true }],
      access: { publicRead: true }, // anyone can read a published author…
    };
    const BOOKS: CollectionDefinition = {
      slug: 'books',
      name: 'Books',
      shape: 'collection',
      fields: [
        { key: 'title', type: 'text', required: true, index: true },
        // Indexed relation — produces backlinks (edges live in document_index).
        { key: 'author', type: 'relation', config: { collection: 'authors' }, index: true },
        // NOT indexed — must never produce a backlink.
        { key: 'mention', type: 'relation', config: { collection: 'authors' } },
      ],
      // …but books are NOT publicRead: their edges are invisible to outsiders.
    };
    await collectionsService.createCollection(db, admin, AUTHORS, NOW);
    await collectionsService.createCollection(db, admin, BOOKS, NOW);
    const ada = await docs.createDocument(db, admin, 'authors', { name: 'Ada' }, NOW);
    const book = await docs.createDocument(
      db,
      admin,
      'books',
      { title: 'Notes', author: ada.id, mention: ada.id },
      NOW,
    );

    // Admin traverses the reverse edge (once — the unindexed field adds nothing).
    const links = await docs.getBacklinks(db, admin, 'authors', ada.id, NOW);
    expect(links).toEqual([
      { id: book.id, collection: 'books', title: 'Notes', status: 'published', updatedAt: NOW },
    ]);

    // The roleless reader may read the author but not books — edges invisible.
    const asNobody = await docs.getBacklinks(db, nobody, 'authors', ada.id, NOW);
    expect(asNobody).toEqual([]);

    // Removing the reference removes the backlink (index re-sync).
    await docs.updateDocument(db, admin, 'books', book.id, { author: undefined }, NOW);
    expect(await docs.getBacklinks(db, admin, 'authors', ada.id, NOW)).toEqual([]);
  });

  it('B2: a configured titleField overrides the first-text-field default', async () => {
    const TARGETS: CollectionDefinition = {
      slug: 'targets',
      name: 'Targets',
      shape: 'collection',
      fields: [
        { key: 'code', type: 'text', required: true, index: true },
        { key: 'display', type: 'text' },
      ],
    };
    const SOURCES: CollectionDefinition = {
      slug: 'sources',
      name: 'Sources',
      shape: 'collection',
      fields: [
        { key: 'name', type: 'text', required: true, index: true },
        { key: 'target', type: 'relation', config: { collection: 'targets', titleField: 'display' } },
      ],
    };
    await collectionsService.createCollection(db, admin, TARGETS, NOW);
    await collectionsService.createCollection(db, admin, SOURCES, NOW);
    const t = await docs.createDocument(db, admin, 'targets', { code: 'T-1', display: 'The One' }, NOW);
    const s = await docs.createDocument(db, admin, 'sources', { name: 'S', target: t.id }, NOW);
    const read = await docs.getDocument(db, admin, 'sources', s.id, NOW);
    expect(read.relations?.target).toEqual({ id: t.id, title: 'The One', collection: 'targets' });
  });

  it('B2: expansion is permission-scoped — an unreadable target expands with title:null', async () => {
    const SECRETS: CollectionDefinition = {
      slug: 'secrets',
      name: 'Secrets',
      shape: 'collection',
      fields: [{ key: 'name', type: 'text', required: true, index: true }],
      // NOT publicRead — the roleless reader below cannot read it.
    };
    const NOTES: CollectionDefinition = {
      slug: 'notes',
      name: 'Notes',
      shape: 'collection',
      fields: [
        { key: 'title', type: 'text', required: true, index: true },
        { key: 'about', type: 'relation', config: { collection: 'secrets' } },
      ],
      access: { publicRead: true }, // readable by anyone once published
    };
    await collectionsService.createCollection(db, admin, SECRETS, NOW);
    await collectionsService.createCollection(db, admin, NOTES, NOW);
    const secret = await docs.createDocument(db, admin, 'secrets', { name: 'Classified' }, NOW);
    const note = await docs.createDocument(db, admin, 'notes', { title: 'N', about: secret.id }, NOW);

    // Admin sees the resolved title…
    const asAdmin = await docs.getDocument(db, admin, 'notes', note.id, NOW);
    expect(asAdmin.relations?.about).toEqual({ id: secret.id, title: 'Classified', collection: 'secrets' });

    // …the roleless reader sees the reference but NOT the gated title.
    const asNobody = await docs.getDocument(db, nobody, 'notes', note.id, NOW);
    expect(asNobody.relations?.about).toEqual({ id: secret.id, title: null, collection: 'secrets' });
  });

  it('multi-valued relation: sort is rejected (non-deterministic across N rows)', async () => {
    const TEAMS: CollectionDefinition = {
      slug: 'teams',
      name: 'Teams',
      shape: 'collection',
      fields: [
        { key: 'name', type: 'text', required: true, index: true },
        { key: 'members', type: 'relation', config: { collection: 'people', multiple: true }, index: true },
      ],
    };
    await collectionsService.createCollection(db, admin, TEAMS, NOW);
    await expect(
      docs.listDocuments(db, admin, 'teams', { sort: { field: 'members', dir: 'asc' } }, NOW),
    ).rejects.toBeInstanceOf(BadRequestError);
    // …while filtering by the same field stays allowed.
    await expect(
      docs.listDocuments(db, admin, 'teams', { filters: { members: 'doc_x' } }, NOW),
    ).resolves.toBeTruthy();
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

  it('removes the document_index rows when the document is deleted (FK cascade)', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'To Delete', views: 7 }, NOW);
    expect((await indexRows(db, doc.id)).length).toBeGreaterThan(0); // title/slug/views indexed

    await docs.deleteDocument(db, admin, 'posts', doc.id, NOW);

    expect(await indexRows(db, doc.id)).toHaveLength(0); // index cascaded away
    await expect(docs.getDocument(db, admin, 'posts', doc.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
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
