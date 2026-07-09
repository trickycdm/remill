import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { insertMedia } from '@/db/queries/media';
import { anonymousPrincipal, type Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-04T12:00:00Z';

const GALLERY: CollectionDefinition = {
  slug: 'gallery',
  name: 'Gallery',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    { key: 'hero', type: 'media' },
    { key: 'body', type: 'markdown' },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

describe('documents — media read-path expansion (C1)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, GALLERY, NOW);
    await insertMedia(db, {
      id: 'med_hero',
      r2Key: 'k/med_hero',
      filename: 'hero.png',
      mime: 'image/png',
      size: 2048,
      width: 1200,
      height: 630,
      duration: null,
      alt: 'A hero photo',
      createdBy: admin.id,
      now: NOW,
    });
  });

  it('attaches alt + intrinsic dimensions as a sibling of data (batched, no N+1)', async () => {
    const doc = await docs.createDocument(db, admin, 'gallery', { title: 'Post', hero: 'med_hero', body: 'x' }, NOW);
    const read = await docs.getDocument(db, admin, 'gallery', doc.id, NOW);
    expect(read.media?.hero).toEqual({ id: 'med_hero', alt: 'A hero photo', width: 1200, height: 630 });
    // data still carries the raw id — expansion is a sibling (round-trip safe).
    expect(read.data.hero).toBe('med_hero');
  });

  it('a missing/deleted asset yields no media sibling — never a throw', async () => {
    const doc = await docs.createDocument(db, admin, 'gallery', { title: 'Ghost', hero: 'med_gone' }, NOW);
    const read = await docs.getDocument(db, admin, 'gallery', doc.id, NOW);
    expect(read.media).toBeUndefined();
    expect(read.data.hero).toBe('med_gone');
  });

  it('degrades (no throw, no sibling) when the reader cannot read media', async () => {
    const doc = await docs.createDocument(db, admin, 'gallery', { title: 'Public', hero: 'med_hero', body: 'x' }, NOW);
    await docs.setPublished(db, admin, 'gallery', doc.id, true, NOW);
    // Anonymous reads the published publicRead doc fine; the `media` collection is
    // unseeded in this harness, so media read is denied and expansion degrades
    // (in production media is publicRead, so alt WOULD attach). The invariant under
    // test: a public read never 500s over media metadata.
    const read = await docs.getDocument(db, anonymousPrincipal('rest'), 'gallery', doc.id, NOW);
    expect(read.id).toBe(doc.id);
    expect(read.media).toBeUndefined();
  });
});
