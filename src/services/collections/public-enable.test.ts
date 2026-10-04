import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as svc from '@/services/collections';
import * as docs from '@/services/documents';
import type { Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';
import { ConflictError, ForbiddenError, InputValidationError } from '@/lib/errors';
import { pollEvents } from '@/services/events';
import { effectiveVisibility } from '@/lib/visibility';

const NOW = '2026-09-27T12:00:00Z';

/** A collection WITHOUT public pages — born-published docs (default lifecycle). */
const REPORTS: CollectionDefinition = {
  slug: 'reports',
  name: 'Reports',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
};
const PUBLIC_REPORTS: CollectionDefinition = { ...REPORTS, access: { publicRead: true } };

describe('D57 — publicRead never turns on without a choice about existing documents', () => {
  let db: Database;
  let admin: Principal;
  let editor: Principal; // publish, but no manage_schema
  let anon: Principal;
  let a: string;
  let b: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    editor = await makePrincipal(db, NOW, { id: 'prn_ed', role: 'editor' });
    anon = await makePrincipal(db, NOW, { id: 'anonymous', role: 'anonymous' });
    await svc.createCollection(db, admin, REPORTS, NOW);
    a = (await docs.createDocument(db, admin, 'reports', { title: 'A' }, NOW)).id;
    b = (await docs.createDocument(db, admin, 'reports', { title: 'B' }, NOW)).id;
  });

  const anonCanRead = (id: string) =>
    docs.getDocument(db, anon, 'reports', id, NOW).then(
      () => true,
      () => false,
    );

  it('effectiveVisibility: private without publicRead, whatever the stored value says', () => {
    expect(effectiveVisibility(REPORTS, { visibility: 'public' })).toBe('private');
    expect(effectiveVisibility(PUBLIC_REPORTS, { visibility: 'unlisted' })).toBe('unlisted');
    expect(effectiveVisibility(PUBLIC_REPORTS, {})).toBe('public');
  });

  it('refuses a bare flip that would expose existing documents (409), and changes nothing', async () => {
    await expect(
      svc.updateCollection(db, admin, 'reports', PUBLIC_REPORTS, NOW),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await svc.getCollection(db, 'reports'))?.access?.publicRead).toBeUndefined();
    expect(await anonCanRead(a)).toBe(false);
  });

  it("onEnablePublic: 'private' flips the collection and keeps every existing document private", async () => {
    await svc.updateCollection(db, admin, 'reports', PUBLIC_REPORTS, NOW, {
      onEnablePublic: 'private',
    });
    expect((await svc.getCollection(db, 'reports'))?.access?.publicRead).toBe(true);
    expect(await anonCanRead(a)).toBe(false);
    expect(await anonCanRead(b)).toBe(false);
    expect((await docs.getDocument(db, admin, 'reports', a, NOW)).visibility).toBe('private');
  });

  it("onEnablePublic: 'keep' publishes them as they are (explicit opt-in)", async () => {
    await svc.updateCollection(db, admin, 'reports', PUBLIC_REPORTS, NOW, {
      onEnablePublic: 'keep',
    });
    expect(await anonCanRead(a)).toBe(true);
  });

  it('a flip with no exposable documents needs no choice', async () => {
    await svc.updateCollection(db, admin, 'reports', PUBLIC_REPORTS, NOW, {
      onEnablePublic: 'private',
    });
    await svc.updateCollection(db, admin, 'reports', REPORTS, NOW);
    // every doc is already private now → turning it back on is safe
    await expect(
      svc.updateCollection(db, admin, 'reports', PUBLIC_REPORTS, NOW),
    ).resolves.toBeDefined();
  });

  it('enablePublicPages exposes ONLY the chosen document, atomically, with one event per changed doc', async () => {
    const cursor = (await pollEvents(db, admin, { limit: 500 })).nextSince;
    await svc.enablePublicPages(db, admin, 'reports', { id: a, visibility: 'unlisted' }, NOW);
    expect(await anonCanRead(a)).toBe(true);
    expect(await anonCanRead(b)).toBe(false);
    expect((await docs.getDocument(db, admin, 'reports', a, NOW)).visibility).toBe('unlisted');
    const after = await pollEvents(db, admin, { since: cursor });
    const types = after.data.map((e) => `${e.type}:${e.resource}`);
    expect(types).toContain('collection.updated:reports');
    expect(types).toContain(`document.visibility_changed:${a}`);
    expect(types).toContain(`document.visibility_changed:${b}`);
    expect(types.filter((t) => t.startsWith('document.visibility_changed'))).toHaveLength(2);
  });

  it('enablePublicPages needs manage_schema — a publisher alone is refused and nothing changes', async () => {
    await expect(
      svc.enablePublicPages(db, editor, 'reports', { id: a, visibility: 'public' }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await anonCanRead(a)).toBe(false);
  });

  it('enablePublicPages rejects a bad visibility and an already-public collection', async () => {
    await expect(
      svc.enablePublicPages(db, admin, 'reports', { id: a, visibility: 'everyone' as never }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
    await svc.enablePublicPages(db, admin, 'reports', { id: a, visibility: 'public' }, NOW);
    await expect(
      svc.enablePublicPages(db, admin, 'reports', { id: b, visibility: 'public' }, NOW),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('parseOnEnablePublic accepts the two choices and rejects anything else', () => {
    expect(svc.parseOnEnablePublic(undefined)).toBeUndefined();
    expect(svc.parseOnEnablePublic('')).toBeUndefined();
    expect(svc.parseOnEnablePublic('private')).toBe('private');
    expect(svc.parseOnEnablePublic('keep')).toBe('keep');
    expect(() => svc.parseOnEnablePublic('yes')).toThrow(InputValidationError);
  });
});
