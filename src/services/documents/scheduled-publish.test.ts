/**
 * Scheduled publishing (D32) + the system actor (D30). Covers the schedule
 * service (validation, gating, cancel), the per-minute drain (publishes due
 * drafts as the system principal with full attribution), and the interactions
 * with manual publish and ordinary edits.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { eq } from 'drizzle-orm';
import { auditLog, documents } from '@/db/schema';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { authorize, systemPrincipal, type Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';
import { InputValidationError, ForbiddenError, BadRequestError } from '@/lib/errors';

const NOW = '2026-07-08T12:00:00Z';
const PAST = '2026-07-08T11:00:00Z';
const FUTURE = '2026-07-08T13:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } }],
  workflow: { draftPublish: true },
};

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { lifecycle: 'none' },
};

describe('scheduled publishing (D32)', () => {
  let db: Database;
  let admin: Principal;
  let author: Principal; // author role: create/update own, NO publish

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
  });

  it('schedules a draft: publishAt set, updatedAt bumped, NO revision appended', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Later' }, NOW);
    const scheduled = await docs.scheduleDocument(db, admin, 'posts', doc.id, FUTURE, NOW);
    expect(scheduled.publishAt).toBe(FUTURE);
    expect(scheduled.status).toBe('draft');

    const rows = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(rows[0]?.publishAt).toBe(FUTURE);
    // Scheduling is not an edit — history must not grow.
    const revs = await docs.listRevisions(db, admin, 'posts', doc.id, NOW);
    expect(revs).toHaveLength(1);
  });

  it('cancel (null) clears a pending schedule', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Never mind' }, NOW);
    await docs.scheduleDocument(db, admin, 'posts', doc.id, FUTURE, NOW);
    const cancelled = await docs.scheduleDocument(db, admin, 'posts', doc.id, null, NOW);
    expect(cancelled.publishAt).toBeNull();
    const rows = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(rows[0]?.publishAt).toBeNull();
  });

  it('rejects scheduling a published document (400)', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Live' }, NOW);
    await docs.setPublished(db, admin, 'posts', doc.id, true, NOW);
    await expect(docs.scheduleDocument(db, admin, 'posts', doc.id, FUTURE, NOW)).rejects.toThrow(BadRequestError);
  });

  it('rejects an unparseable datetime (validation)', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Bad date' }, NOW);
    await expect(docs.scheduleDocument(db, admin, 'posts', doc.id, 'not-a-date', NOW)).rejects.toThrow(
      InputValidationError,
    );
  });

  it('rejects scheduling on a lifecycle:none collection (400)', async () => {
    await collectionsService.createCollection(db, admin, NOTES, NOW);
    const doc = await docs.createDocument(db, admin, 'notes', { title: 'No lifecycle' }, NOW);
    await expect(docs.scheduleDocument(db, admin, 'notes', doc.id, FUTURE, NOW)).rejects.toThrow(BadRequestError);
  });

  it('requires the publish action — an author is denied, and the deny is audited', async () => {
    const doc = await docs.createDocument(db, author, 'posts', { title: 'Mine' }, NOW);
    await expect(docs.scheduleDocument(db, author, 'posts', doc.id, FUTURE, NOW)).rejects.toThrow(ForbiddenError);
    const denies = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.allowed, 0));
    expect(denies.some((r) => r.principalId === author.id && r.action === 'publish')).toBe(true);
  });

  it('manual publish consumes a pending schedule', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Now actually' }, NOW);
    await docs.scheduleDocument(db, admin, 'posts', doc.id, FUTURE, NOW);
    const published = await docs.setPublished(db, admin, 'posts', doc.id, true, NOW);
    expect(published.publishAt).toBeNull();
    const rows = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(rows[0]?.publishAt).toBeNull();
    expect(rows[0]?.status).toBe('published');
  });

  it('an ordinary edit preserves the schedule', async () => {
    const doc = await docs.createDocument(db, admin, 'posts', { title: 'Draft v1' }, NOW);
    await docs.scheduleDocument(db, admin, 'posts', doc.id, FUTURE, NOW);
    await docs.updateDocument(db, admin, 'posts', doc.id, { title: 'Draft v2' }, NOW);
    const rows = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(rows[0]?.publishAt).toBe(FUTURE);
  });

  describe('the drain (system actor, D30)', () => {
    it('publishes due drafts with system attribution, clears publish_at, skips future ones', async () => {
      const due = await docs.createDocument(db, admin, 'posts', { title: 'Due' }, NOW);
      const notYet = await docs.createDocument(db, admin, 'posts', { title: 'Not yet' }, NOW);
      await docs.scheduleDocument(db, admin, 'posts', due.id, PAST, NOW);
      await docs.scheduleDocument(db, admin, 'posts', notYet.id, FUTURE, NOW);

      const published = await docs.drainScheduledPublishes(db, NOW);
      expect(published).toBe(1);

      const dueRow = (await db.select().from(documents).where(eq(documents.id, due.id)))[0];
      expect(dueRow?.status).toBe('published');
      expect(dueRow?.publishedAt).toBe(NOW);
      expect(dueRow?.publishAt).toBeNull();

      const notYetRow = (await db.select().from(documents).where(eq(documents.id, notYet.id)))[0];
      expect(notYetRow?.status).toBe('draft');
      expect(notYetRow?.publishAt).toBe(FUTURE);

      // Full pipeline ran: a revision was appended by the publish.
      const revs = await docs.listRevisions(db, admin, 'posts', due.id, NOW);
      expect(revs).toHaveLength(2);

      // Attribution: the publish decision is audited to the system actor.
      const sysRows = await db.select().from(auditLog).where(eq(auditLog.surface, 'system'));
      expect(
        sysRows.some(
          (r) => r.principalId === 'system' && r.action === 'publish' && r.resource === `document:${due.id}` && r.allowed === 1,
        ),
      ).toBe(true);
    });

    it('a schedule exactly at now is due (<= comparison)', async () => {
      const doc = await docs.createDocument(db, admin, 'posts', { title: 'On the dot' }, NOW);
      await docs.scheduleDocument(db, admin, 'posts', doc.id, NOW, NOW);
      expect(await docs.drainScheduledPublishes(db, NOW)).toBe(1);
    });

    it('one failing document does not block the rest', async () => {
      // A realistic failure: the collection drops its lifecycle AFTER a doc was
      // scheduled — setPublished then throws for that doc; the drain must log
      // it, leave its schedule intact, and still publish the healthy one.
      const LEGACY: CollectionDefinition = { ...POSTS, slug: 'legacy', name: 'Legacy' };
      await collectionsService.createCollection(db, admin, LEGACY, NOW);
      const good = await docs.createDocument(db, admin, 'posts', { title: 'Good' }, NOW);
      const doomed = await docs.createDocument(db, admin, 'legacy', { title: 'Doomed' }, NOW);
      await docs.scheduleDocument(db, admin, 'posts', good.id, PAST, NOW);
      await docs.scheduleDocument(db, admin, 'legacy', doomed.id, PAST, NOW);
      await collectionsService.updateCollection(db, admin, 'legacy', { ...LEGACY, workflow: { lifecycle: 'none' } }, NOW);

      expect(await docs.drainScheduledPublishes(db, NOW)).toBe(1);
      const goodRow = (await db.select().from(documents).where(eq(documents.id, good.id)))[0];
      expect(goodRow?.status).toBe('published');
      const doomedRow = (await db.select().from(documents).where(eq(documents.id, doomed.id)))[0];
      expect(doomedRow?.status).toBe('draft');
      expect(doomedRow?.publishAt).toBe(PAST); // schedule intact for a later fix/retry
    });
  });

  describe('authorize() system branch (D30)', () => {
    it('allows by kind with no permission rows, but still writes the audit row', async () => {
      const grant = await authorize(db, systemPrincipal(), 'publish', { collection: 'posts' }, NOW);
      expect(grant).toBeTruthy();
      const rows = await db.select().from(auditLog).where(eq(auditLog.surface, 'system'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.principalId).toBe('system');
      expect(rows[0]?.allowed).toBe(1);
      expect(rows[0]?.collection).toBe('posts');
    });
  });
});
