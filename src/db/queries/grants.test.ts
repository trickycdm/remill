/**
 * Item-grant queries (D51 additions): a link grant carries an optional
 * `passwordHash` + `label`. `ItemGrantRecord` exposes `hasPassword`/`label`
 * ONLY — the hash never rides on the record; `getLinkGrantPasswordHash` is the
 * one internal accessor the unlock check uses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import {
  createItemGrant,
  getLinkGrantPasswordHash,
  listGrantsForDocument,
} from '@/db/queries/grants';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-09-23T12:00:00Z';

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

describe('item grant queries (D51: label + password_hash)', () => {
  let db: Database;
  let admin: Principal;
  let docId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, NOTES, NOW);
    docId = (await docs.createDocument(db, admin, 'notes', { title: 'Linkable' }, NOW)).id;
  });

  it('a password-protected link grant exposes hasPassword + label, never the hash', async () => {
    const grantId = await createItemGrant(
      db,
      {
        subjectKind: 'link',
        subjectId: 'hashed-token-value',
        documentId: docId,
        actions: ['read'],
        grantedBy: admin.id,
        expiresAt: null,
        passwordHash: 'scrypt$salt$hash',
        label: 'Acme review',
      },
      NOW,
    );

    const rows = await listGrantsForDocument(db, docId);
    const row = rows.find((r) => r.id === grantId)!;
    expect(row.label).toBe('Acme review');
    expect(row.hasPassword).toBe(true);
    // The hash is not a key on the domain record at all.
    expect(Object.keys(row)).not.toContain('passwordHash');
    expect(JSON.stringify(row)).not.toContain('scrypt$salt$hash');

    const hash = await getLinkGrantPasswordHash(db, grantId);
    expect(hash).toBe('scrypt$salt$hash');
  });

  it('a plain link grant (no password) reports hasPassword: false and a null label', async () => {
    const grantId = await createItemGrant(
      db,
      {
        subjectKind: 'link',
        subjectId: 'another-hashed-token',
        documentId: docId,
        actions: ['read'],
        grantedBy: admin.id,
        expiresAt: null,
      },
      NOW,
    );

    const rows = await listGrantsForDocument(db, docId);
    const row = rows.find((r) => r.id === grantId)!;
    expect(row.hasPassword).toBe(false);
    expect(row.label).toBeNull();
    expect(await getLinkGrantPasswordHash(db, grantId)).toBeNull();
  });

  it('getLinkGrantPasswordHash returns null for an unknown grant id (no enumeration oracle)', async () => {
    expect(await getLinkGrantPasswordHash(db, 'grn_does_not_exist')).toBeNull();
  });
});
