import { describe, it, expect } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb } from '@/db/client';
import { authenticateUser } from '@/services/auth';
import { getUserByEmail } from '@/db/queries/users';
import { collections } from '@/db/schema';

describe('Phase 1 foundation — auth + seed round-trip', () => {
  it('seeds the admin user and authenticates with the default password', async () => {
    const db = getDb(createTestD1({ seed: true }));

    const user = await getUserByEmail(db, 'admin@remill.local');
    expect(user).not.toBeNull();
    expect(user?.displayName).toBe('Administrator');

    const authed = await authenticateUser(db, 'admin@remill.local', 'remilladmin');
    expect(authed).not.toBeNull();
    expect(authed?.role).toBe('admin');
    expect(authed?.id).toBe('prn_admin0000000000000');
  });

  it('rejects a wrong password and an unknown email (no distinction leaked)', async () => {
    const db = getDb(createTestD1({ seed: true }));
    expect(await authenticateUser(db, 'admin@remill.local', 'wrong')).toBeNull();
    expect(await authenticateUser(db, 'nobody@remill.local', 'remilladmin')).toBeNull();
  });

  it('normalizes email case on lookup', async () => {
    const db = getDb(createTestD1({ seed: true }));
    const user = await getUserByEmail(db, 'ADMIN@Remill.Local');
    expect(user?.email).toBe('admin@remill.local');
  });

  it('applies the schema with the two protected collections seeded', async () => {
    const db = getDb(createTestD1({ seed: true }));
    const rows = await db.select().from(collections);
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(bySlug.settings?.shape).toBe('singleton');
    expect(bySlug.settings?.protected).toBe(1);
    expect(bySlug.media?.shape).toBe('collection');
    expect(bySlug.media?.protected).toBe(1);
  });
});
