import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { authorize, compileReadFilter, resolveAccess, type Principal, type Action } from '@/access';
import { Grant } from '@/access/grant';
import { documents } from '@/db/schema';
import { seedRoles, makePrincipal } from '@/test/access';
import { recentAudit } from '@/db/queries/audit';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import * as access from '@/services/access';
import type { CollectionDefinition } from '@/fields/types';
import { ForbiddenError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';
const LATER = '2026-07-05T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

// The expected policy — the source of truth the matrix asserts against.
const ITEM_PUBLISHED = { collection: 'posts', documentId: 'doc_x', status: 'published' as const, createdBy: 'prn_other' };
const ITEM_OWN_DRAFT = { collection: 'posts', documentId: 'doc_y', status: 'draft' as const, createdBy: 'SELF' };

describe('access control — the full model (Phase 3)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
  });

  it('returns a Grant witness on allow and throws structured 403 on deny', async () => {
    const grant = await authorize(db, admin, 'create', { collection: 'posts' }, NOW);
    expect(grant).toBeInstanceOf(Grant);
    const nobody = await makePrincipal(db, NOW, { id: 'prn_none' });
    await expect(authorize(db, nobody, 'create', { collection: 'posts' }, NOW)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      missing: { action: 'create', collection: 'posts' },
    });
  });

  it('permission matrix — every role × action, default-deny for uncovered cells', async () => {
    const cases: Array<{ role?: string; action: Action; resource: object; allow: boolean }> = [
      // admin: everything
      { role: 'admin', action: 'manage_schema', resource: { collection: 'posts' }, allow: true },
      { role: 'admin', action: 'manage_access', resource: { collection: 'posts' }, allow: true },
      // editor: content actions yes, management no
      { role: 'editor', action: 'create', resource: { collection: 'posts' }, allow: true },
      { role: 'editor', action: 'publish', resource: { collection: 'posts' }, allow: true },
      { role: 'editor', action: 'manage_schema', resource: { collection: 'posts' }, allow: false },
      { role: 'editor', action: 'manage_access', resource: { collection: 'posts' }, allow: false },
      // author: create yes; publish/delete no; update own yes, others' no
      { role: 'author', action: 'create', resource: { collection: 'posts' }, allow: true },
      { role: 'author', action: 'publish', resource: { collection: 'posts', documentId: 'd', status: 'draft' }, allow: false },
      { role: 'author', action: 'delete', resource: { collection: 'posts', documentId: 'd' }, allow: false },
      // reader: read published yes, read draft no, create no
      { role: 'reader', action: 'read', resource: { collection: 'posts', documentId: 'd', status: 'published' }, allow: true },
      { role: 'reader', action: 'read', resource: { collection: 'posts', documentId: 'd', status: 'draft' }, allow: false },
      { role: 'reader', action: 'create', resource: { collection: 'posts' }, allow: false },
      // no role: default deny (publicRead covers published reads, but NOT drafts)
      { role: undefined, action: 'read', resource: { collection: 'posts', documentId: 'd', status: 'draft' }, allow: false },
      { role: undefined, action: 'create', resource: { collection: 'posts' }, allow: false },
    ];

    for (const [i, c] of cases.entries()) {
      const p = await makePrincipal(db, NOW, { id: `prn_m${i}`, role: c.role });
      const run = authorize(db, p, c.action, c.resource as never, NOW);
      if (c.allow) {
        await expect(run, `${c.role ?? 'none'} should ${c.action}`).resolves.toBeInstanceOf(Grant);
      } else {
        await expect(run, `${c.role ?? 'none'} should NOT ${c.action}`).rejects.toBeInstanceOf(ForbiddenError);
      }
    }
  });

  it("condition 'own' — author may update own draft but not another's", async () => {
    const author = await makePrincipal(db, NOW, { id: 'prn_auth', kind: 'agent', role: 'author', surface: 'mcp' });
    const own = { ...ITEM_OWN_DRAFT, createdBy: author.id };
    await expect(authorize(db, author, 'update', own, NOW)).resolves.toBeInstanceOf(Grant);
    await expect(authorize(db, author, 'update', ITEM_PUBLISHED, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('item grants — a per-document grant allows an otherwise-denied action, and expiry is honored', async () => {
    const post = await docs.createDocument(db, admin, 'posts', { title: 'Grantable' }, NOW);
    const researcher = await makePrincipal(db, NOW, { id: 'prn_res', kind: 'agent', role: 'reader', surface: 'mcp' });

    // Without a grant, researcher cannot update.
    await expect(
      authorize(db, researcher, 'update', { collection: 'posts', documentId: post.id }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Grant update until LATER.
    await access.grantItem(
      db,
      admin,
      { subjectKind: 'principal', subjectId: researcher.id, documentId: post.id, collection: 'posts', actions: ['update'], expiresAt: LATER },
      NOW,
    );
    await expect(
      authorize(db, researcher, 'update', { collection: 'posts', documentId: post.id }, NOW),
    ).resolves.toBeInstanceOf(Grant);

    // After expiry, the grant no longer applies.
    await expect(
      authorize(db, researcher, 'update', { collection: 'posts', documentId: post.id }, '2026-07-06T00:00:00Z'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('token scope mask narrows — a read-only token cannot create even for an admin', async () => {
    const scoped = await makePrincipal(db, NOW, {
      id: 'prn_scoped',
      role: 'admin',
      surface: 'rest',
      tokenScope: [{ collection: '*', action: 'read' }],
    });
    await expect(authorize(db, scoped, 'read', { collection: 'posts', documentId: 'd', status: 'published' }, NOW)).resolves.toBeInstanceOf(Grant);
    await expect(authorize(db, scoped, 'create', { collection: 'posts' }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('publicRead — anonymous may read published docs of a publicRead collection', async () => {
    const anon = await makePrincipal(db, NOW, { id: 'anonymous', role: 'anonymous' });
    await expect(
      authorize(db, anon, 'read', { collection: 'posts', documentId: 'd', status: 'published' }, NOW),
    ).resolves.toBeInstanceOf(Grant);
    await expect(
      authorize(db, anon, 'read', { collection: 'posts', documentId: 'd', status: 'draft' }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('LIST-LEAK: a reader never sees drafts and the count matches the filtered set', async () => {
    // admin authors 2 published + 2 drafts; author authors 1 own draft.
    const author = await makePrincipal(db, NOW, { id: 'prn_wr', role: 'author', surface: 'mcp' });
    const p1 = await docs.createDocument(db, admin, 'posts', { title: 'Pub One' }, NOW);
    const p2 = await docs.createDocument(db, admin, 'posts', { title: 'Pub Two' }, NOW);
    await docs.createDocument(db, admin, 'posts', { title: 'Admin Draft' }, NOW);
    await docs.setPublished(db, admin, 'posts', p1.id, true, NOW);
    await docs.setPublished(db, admin, 'posts', p2.id, true, NOW);
    const ownDraft = await docs.createDocument(db, author, 'posts', { title: 'Author Draft' }, NOW);

    // Reader: sees exactly the 2 published, count matches, no drafts leak.
    const reader = await makePrincipal(db, NOW, { id: 'prn_rd', role: 'reader' });
    const rlist = await docs.listDocuments(db, reader, 'posts', { pageSize: 50 }, NOW);
    expect(rlist.total).toBe(2);
    expect(rlist.rows.every((r) => r.status === 'published')).toBe(true);

    // Author: sees the 2 published + their own draft, but NOT admin's draft.
    const alist = await docs.listDocuments(db, author, 'posts', { pageSize: 50 }, NOW);
    const ids = alist.rows.map((r) => r.id);
    expect(alist.total).toBe(3);
    expect(ids).toContain(ownDraft.id);
    expect(alist.rows.filter((r) => r.status === 'draft').every((r) => r.createdBy === author.id)).toBe(true);
  });

  it('compileReadFilter returns undefined for an unrestricted admin', async () => {
    expect(await compileReadFilter(db, admin, 'posts', NOW)).toBeUndefined();
  });

  it('TD-3: compileReadFilter is byte-identical with or without pre-resolved access', async () => {
    // The read path now resolves {permissions, publicRead} once and threads it into
    // both authorize() and compileReadFilter(). Prove the compiled predicate is
    // unchanged whether or not the pre-resolved inputs are supplied.
    const reader = await makePrincipal(db, NOW, { id: 'prn_rdr', role: 'reader' });
    const resolved = await resolveAccess(db, reader.id, 'posts');

    const filterUnresolved = await compileReadFilter(db, reader, 'posts', NOW);
    const filterResolved = await compileReadFilter(db, reader, 'posts', NOW, resolved);

    expect(filterUnresolved).toBeDefined(); // a reader IS restricted (not a no-op)
    const render = (f: typeof filterUnresolved) => db.select().from(documents).where(f).toSQL();
    expect(render(filterResolved)).toEqual(render(filterUnresolved));
  });

  it('audit — every allow and every deny is recorded with surface + principal', async () => {
    const before = (await recentAudit(db, 1000)).length;
    await authorize(db, admin, 'read', { collection: 'posts', documentId: 'd', status: 'published' }, NOW);
    const nobody = await makePrincipal(db, NOW, { id: 'prn_z', surface: 'rest' });
    await authorize(db, nobody, 'delete', { collection: 'posts', documentId: 'd' }, NOW).catch(() => {});
    const rows = await recentAudit(db, 1000);
    expect(rows.length).toBe(before + 2);
    const allow = rows.find((r) => r.principalId === 'prn_admin' && r.action === 'read');
    const deny = rows.find((r) => r.principalId === 'prn_z' && r.action === 'delete');
    expect(allow?.allowed).toBe(1);
    expect(deny?.allowed).toBe(0);
    expect(deny?.surface).toBe('rest');
  });
});
