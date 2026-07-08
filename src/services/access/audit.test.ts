/**
 * Audit surfacing (completion-roadmap Phase 4): the queryable, filtered,
 * keyset-paginated read over the append-only audit log, and the denormalized
 * `collection` column authorize() now stamps on every row.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { listAuditPage } from '@/services/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import { ForbiddenError } from '@/lib/errors';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-04T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

describe('audit read surface — filters, cursor, gating', () => {
  let db: Database;
  let admin: Principal;
  let reader: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    await docs.createDocument(db, admin, 'posts', { title: 'One' }, NOW); // allow rows
    await docs.createDocument(db, admin, 'posts', { title: 'Two' }, NOW);
    await docs.createDocument(db, reader, 'posts', { title: 'Nope' }, NOW).catch(() => {}); // a deny row
  });

  it('rows carry the denormalized collection; filters narrow correctly', async () => {
    const all = await listAuditPage(db, admin, {}, NOW);
    expect(all.rows.length).toBeGreaterThan(0);
    expect(all.rows.every((r) => r.collection !== undefined)).toBe(true);

    const denies = await listAuditPage(db, admin, { filters: { allowed: false } }, NOW);
    expect(denies.rows.length).toBeGreaterThan(0);
    expect(denies.rows.every((r) => r.allowed === 0)).toBe(true);
    expect(denies.rows.some((r) => r.principalId === reader.id && r.action === 'create')).toBe(true);

    const posts = await listAuditPage(db, admin, { filters: { collection: 'posts', action: 'create' } }, NOW);
    expect(posts.rows.every((r) => r.collection === 'posts' && r.action === 'create')).toBe(true);

    const byPrincipal = await listAuditPage(db, admin, { filters: { principalId: reader.id } }, NOW);
    expect(byPrincipal.rows.every((r) => r.principalId === reader.id)).toBe(true);
  });

  it('keyset cursor pages without overlap or gaps', async () => {
    const first = await listAuditPage(db, admin, { limit: 3 }, NOW);
    expect(first.rows).toHaveLength(3);
    expect(first.nextCursor).toBeDefined();
    const second = await listAuditPage(db, admin, { limit: 3, cursor: first.nextCursor }, NOW);
    const firstIds = new Set(first.rows.map((r) => r.id));
    expect(second.rows.every((r) => !firstIds.has(r.id))).toBe(true);
  });

  it('is manage_access-gated: readers are denied (and that denial is itself audited)', async () => {
    await expect(listAuditPage(db, reader, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const denies = await listAuditPage(db, admin, { filters: { allowed: false, action: 'manage_access' } }, NOW);
    expect(denies.rows.some((r) => r.principalId === reader.id)).toBe(true);
  });
});
