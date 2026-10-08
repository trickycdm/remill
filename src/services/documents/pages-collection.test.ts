import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { anonymousPrincipal, type Principal } from '@/access';
import { PAGES_COLLECTION } from '@/config/constants';
import { AppError, ForbiddenError, InputValidationError } from '@/lib/errors';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-10-04T12:00:00Z';
const PAGE = '<!doctype html><html><head><title>T</title></head><body><p>Hi</p></body></html>';

/** The built-in Pages collection (D62), as the SEED ships it. */
describe('the seeded pages collection (D62)', () => {
  let db: Database;
  let admin: Principal;
  let editor: Principal;
  const anon = anonymousPrincipal('rest');

  beforeEach(async () => {
    db = getDb(createTestD1({ seed: true }));
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    editor = await makePrincipal(db, NOW, {
      id: 'prn_bot',
      kind: 'agent',
      role: 'editor',
      surface: 'mcp',
    });
  });

  it('is a valid, protected, inline-mode definition (D63)', async () => {
    const def = await collectionsService.getCollectionOrThrow(db, PAGES_COLLECTION);
    expect(def).toMatchObject({
      protected: true,
      renderMode: 'inline',
      workflow: { lifecycle: 'none' },
      access: { publicRead: true, defaultVisibility: 'private' },
    });
    expect(def.fields.map((f) => `${f.key}:${f.type}`)).toEqual([
      'title:text',
      'html:html',
      'description:text',
      'tags:tags',
    ]);
    // The seed bypasses the service — the row must still satisfy its rules.
    expect(() => collectionsService.validateDefinition(def)).not.toThrow();
    await expect(
      collectionsService.deleteCollection(db, admin, PAGES_COLLECTION, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('an editor-role agent publishes a page with no schema rights — and it is born private', async () => {
    const page = await docs.createDocument(
      db,
      editor,
      PAGES_COLLECTION,
      { title: 'Report', html: PAGE },
      NOW,
    );
    expect(page).toMatchObject({ status: 'published', visibility: 'private' });

    // Anonymous: no read, and nothing in the list — publicRead alone exposes nothing.
    await expect(docs.getDocument(db, anon, PAGES_COLLECTION, page.id, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await docs.listDocuments(db, anon, PAGES_COLLECTION, {}, NOW)).rows).toEqual([]);

    // Public is an explicit, per-page choice.
    await docs.setVisibility(db, admin, PAGES_COLLECTION, page.id, 'public', NOW);
    expect((await docs.getDocument(db, anon, PAGES_COLLECTION, page.id, NOW)).id).toBe(page.id);
    expect(
      (await docs.listDocuments(db, anon, PAGES_COLLECTION, {}, NOW)).rows.map((r) => r.id),
    ).toEqual([page.id]);
  });

  it('refuses a document too large to store with a clear 413, on create and update', async () => {
    const big = await collectionsService.createCollection(
      db,
      admin,
      {
        slug: 'big',
        name: 'Big',
        shape: 'collection',
        fields: [{ key: 'html', type: 'html', config: { maxLength: 5_000_000 } }],
      },
      NOW,
    );
    const huge = 'x'.repeat(docs.MAX_DOCUMENT_BYTES + 1);
    const tooLarge = (e: unknown) =>
      e instanceof AppError && e.status === 413 && e.code === 'PAYLOAD_TOO_LARGE';
    await expect(docs.createDocument(db, admin, big.slug, { html: huge }, NOW)).rejects.toSatisfy(
      tooLarge,
    );
    const ok = await docs.createDocument(db, admin, big.slug, { html: '<p>fine</p>' }, NOW);
    await expect(
      docs.updateDocument(db, admin, big.slug, ok.id, { html: huge }, NOW),
    ).rejects.toSatisfy(tooLarge);
    // Multi-byte text counts in BYTES: 700k three-byte characters is over.
    await expect(
      docs.createDocument(db, admin, big.slug, { html: '€'.repeat(700_000) }, NOW),
    ).rejects.toSatisfy(tooLarge);
  });
});

describe('access.defaultVisibility + reserved slugs (D62)', () => {
  let db: Database;
  let admin: Principal;
  const NOTES: CollectionDefinition = {
    slug: 'notes',
    name: 'Notes',
    shape: 'collection',
    fields: [{ key: 'title', type: 'text' }],
  };

  beforeEach(async () => {
    db = getDb(createTestD1({ seed: true }));
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
  });

  it('applies only to a publicRead collection, and only to known visibilities', () => {
    const valid = (access: unknown) =>
      collectionsService.validateDefinition({
        ...NOTES,
        access: access as CollectionDefinition['access'],
      });
    expect(valid({ publicRead: true, defaultVisibility: 'unlisted' }).access).toEqual({
      publicRead: true,
      defaultVisibility: 'unlisted',
    });
    expect(() => valid({ defaultVisibility: 'private' })).toThrow(InputValidationError);
    expect(() => valid({ private: true, defaultVisibility: 'private' })).toThrow(
      InputValidationError,
    );
    expect(() => valid({ publicRead: true, defaultVisibility: 'secret' })).toThrow(
      InputValidationError,
    );
  });

  it('new documents take the default; an absent default stays public; an import override wins', async () => {
    await collectionsService.createCollection(
      db,
      admin,
      { ...NOTES, access: { publicRead: true, defaultVisibility: 'unlisted' } },
      NOW,
    );
    expect((await docs.createDocument(db, admin, 'notes', { title: 'a' }, NOW)).visibility).toBe(
      'unlisted',
    );
    expect(
      (await docs.createDocument(db, admin, 'notes', { title: 'b' }, NOW, { visibility: 'public' }))
        .visibility,
    ).toBe('public');

    await collectionsService.createCollection(
      db,
      admin,
      { ...NOTES, slug: 'open', access: { publicRead: true } },
      NOW,
    );
    const open = await docs.createDocument(db, admin, 'open', { title: 'c' }, NOW);
    expect(open.visibility).toBe('public');
    expect((await docs.getDocument(db, admin, 'open', open.id, NOW)).visibility).toBe('public');
  });

  it("refuses to CREATE a collection whose tools would shadow a static one ('page' → publish_page)", async () => {
    await expect(
      collectionsService.createCollection(db, admin, { ...NOTES, slug: 'page' }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
    // …but validation alone (the update path) still accepts the slug, so an
    // install that already has one is not locked out of editing it.
    expect(() => collectionsService.validateDefinition({ ...NOTES, slug: 'page' })).not.toThrow();
  });
});
