import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as svc from '@/services/collections';
import type { Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';
import { InputValidationError, ForbiddenError, ConflictError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';

const valid: CollectionDefinition = {
  slug: 'articles',
  name: 'Articles',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true },
    { key: 'meta', type: 'json' },
  ],
};

function bad(partial: Partial<CollectionDefinition>): CollectionDefinition {
  return { ...valid, ...partial };
}

describe('collections service — definition validation', () => {
  let db: Database;
  let admin: Principal;
  let editor: Principal; // has the editor role — which lacks manage_schema

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    editor = await makePrincipal(db, NOW, { id: 'prn_ed', role: 'editor' });
  });

  it('creates a valid collection', async () => {
    const def = await svc.createCollection(db, admin, valid, NOW);
    expect(def.slug).toBe('articles');
    expect(await svc.getCollection(db, 'articles')).not.toBeNull();
  });

  it('rejects a bad slug', async () => {
    await expect(svc.createCollection(db, admin, bad({ slug: 'Bad Slug' }), NOW)).rejects.toBeInstanceOf(
      InputValidationError,
    );
  });

  it('rejects an unknown field type', async () => {
    await expect(
      svc.createCollection(db, admin, bad({ fields: [{ key: 'x', type: 'wormhole' }] }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects a reserved field key', async () => {
    await expect(
      svc.createCollection(db, admin, bad({ fields: [{ key: 'status', type: 'text' }] }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects duplicate field keys', async () => {
    await expect(
      svc.createCollection(
        db,
        admin,
        bad({ fields: [{ key: 'a', type: 'text' }, { key: 'a', type: 'number' }] }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects index:true on a non-indexable type (json)', async () => {
    await expect(
      svc.createCollection(db, admin, bad({ fields: [{ key: 'blob', type: 'json', index: true }] }), NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('rejects invalid per-field config', async () => {
    await expect(
      svc.createCollection(
        db,
        admin,
        // select requires a non-empty options array
        bad({ fields: [{ key: 'k', type: 'select', config: { options: [] } }] }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it('denies a non-admin (needs manage_schema)', async () => {
    await expect(svc.createCollection(db, editor, valid, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a duplicate collection slug', async () => {
    await svc.createCollection(db, admin, valid, NOW);
    await expect(svc.createCollection(db, admin, valid, NOW)).rejects.toBeInstanceOf(ConflictError);
  });

  it('protects seeded collections from deletion', async () => {
    await svc.createCollection(db, admin, { ...valid, protected: true }, NOW);
    await expect(svc.deleteCollection(db, admin, 'articles', NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
