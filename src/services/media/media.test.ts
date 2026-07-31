import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as media from '@/services/media';
import * as docsService from '@/services/documents';
import * as collectionsService from '@/services/collections';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { BadRequestError, InputValidationError, ConflictError, ForbiddenError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';

/** Minimal in-memory R2 stub covering put/get/delete. */
function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    bucket: {
      async put(key: string, value: Uint8Array) {
        store.set(key, value);
        return {};
      },
      async get(key: string) {
        const v = store.get(key);
        return v ? { body: v } : null;
      },
      async delete(key: string) {
        store.delete(key);
      },
    } as unknown as R2Bucket,
    store,
  };
}

/** A 24-byte PNG header declaring 100×50 (enough for sniff + imageSize). */
function pngBytes(): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  new DataView(b.buffer).setUint32(16, 100);
  new DataView(b.buffer).setUint32(20, 50);
  return b;
}

describe('media service — upload, sniff, alt, delete', () => {
  let db: Database;
  let admin: Principal;
  let r2: ReturnType<typeof fakeR2>;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    r2 = fakeR2();
  });

  it('uploads an image: sniffs mime, extracts dimensions, stores to R2', async () => {
    const rec = await media.uploadMedia(db, r2.bucket, admin, { filename: 'Photo (1).png', bytes: pngBytes(), alt: 'A photo' }, NOW);
    expect(rec.mime).toBe('image/png');
    expect(rec.width).toBe(100);
    expect(rec.height).toBe(50);
    expect(rec.alt).toBe('A photo');
    expect(rec.r2Key).toMatch(/^media\/med_/);
    expect(r2.store.has(rec.r2Key)).toBe(true);
    // filename sanitized (no spaces/parens breaking the key)
    expect(rec.r2Key).not.toContain(' ');
  });

  it('MIME-SPOOF: rejects bytes that match no known signature', async () => {
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    await expect(
      media.uploadMedia(db, r2.bucket, admin, { filename: 'evil.png', bytes: junk, alt: 'x' }, NOW),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('ALT-REQUIRED: rejects an image without alt text (WCAG 2.1 AA)', async () => {
    await expect(
      media.uploadMedia(db, r2.bucket, admin, { filename: 'a.png', bytes: pngBytes() }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects an empty file', async () => {
    await expect(
      media.uploadMedia(db, r2.bucket, admin, { filename: 'empty', bytes: new Uint8Array(0), alt: 'x' }, NOW),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('COR-6: getMediaById is authorize()-gated — denies a caller scoped away from media reads', async () => {
    const rec = await media.uploadMedia(db, r2.bucket, admin, { filename: 'x.png', bytes: pngBytes(), alt: 'X' }, NOW);

    // Admin may read it (this is the path get_media_url now uses).
    const got = await media.getMediaById(db, admin, rec.id, NOW);
    expect(got.id).toBe(rec.id);

    // A token scoped to posts-reads-only must NOT be able to resolve media — even
    // though the media collection is publicRead, the scope mask narrows first.
    const scoped = await makePrincipal(db, NOW, {
      id: 'prn_scoped',
      kind: 'agent',
      tokenScope: [{ collection: 'posts', action: 'read' }],
    });
    await expect(media.getMediaById(db, scoped, rec.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('COR-7/TD-9: listMedia paginates by cursor (no offset), newest first', async () => {
    for (const name of ['one.png', 'two.png', 'three.png']) {
      await media.uploadMedia(db, r2.bucket, admin, { filename: name, bytes: pngBytes(), alt: name }, NOW);
    }

    const page1 = await media.listMedia(db, admin, { limit: 2 }, NOW);
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await media.listMedia(db, admin, { limit: 2, cursor: page1.nextCursor }, NOW);
    expect(page2.rows).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    // No row appears twice across the pages.
    const ids = new Set([...page1.rows, ...page2.rows].map((r) => r.id));
    expect(ids.size).toBe(3);
  });

  it('DELETE is blocked while a document references the media', async () => {
    const rec = await media.uploadMedia(db, r2.bucket, admin, { filename: 'hero.png', bytes: pngBytes(), alt: 'Hero' }, NOW);

    const POSTS: CollectionDefinition = {
      slug: 'posts',
      name: 'Posts',
      shape: 'collection',
      fields: [
        { key: 'title', type: 'text', required: true },
        { key: 'hero', type: 'media', config: { kinds: ['image'] } },
      ],
    };
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    await docsService.createDocument(db, admin, 'posts', { title: 'Uses hero', hero: rec.id }, NOW);

    await expect(media.deleteMedia(db, r2.bucket, admin, rec.id, NOW)).rejects.toBeInstanceOf(ConflictError);

    // Once unreferenced, delete succeeds and removes the R2 object.
    const other = await media.uploadMedia(db, r2.bucket, admin, { filename: 'unused.png', bytes: pngBytes(), alt: 'Unused' }, NOW);
    await media.deleteMedia(db, r2.bucket, admin, other.id, NOW);
    expect(r2.store.has(other.r2Key)).toBe(false);
  });
});
