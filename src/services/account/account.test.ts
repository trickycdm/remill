import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { principals, users } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/password';
import { getUserByEmail } from '@/db/queries/users';
import { updateProfile, changePassword } from '@/services/account';
import { InputValidationError, ConflictError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';

/** Insert a human (principal + credentials) with a known password. */
async function seedHuman(
  db: Database,
  opts: { id: string; email: string; password: string; name: string },
): Promise<void> {
  await db.insert(principals).values({ id: opts.id, kind: 'user', name: opts.name, disabled: 0, createdAt: NOW });
  await db
    .insert(users)
    .values({ principalId: opts.id, email: opts.email, passwordHash: hashPassword(opts.password), createdAt: NOW });
}

describe('account service', () => {
  let db: Database;

  beforeEach(() => {
    // No seed needed — the account surface only touches principals + users.
    db = getDb(createTestD1());
  });

  describe('changePassword', () => {
    beforeEach(() => seedHuman(db, { id: 'prn_a', email: 'a@example.com', password: 'origPass1', name: 'Ada' }));

    it('rejects a wrong current password (generic error, no leak)', async () => {
      await expect(
        changePassword(db, 'prn_a', 'a@example.com', { currentPassword: 'wrongpass', newPassword: 'brandnew12' }),
      ).rejects.toBeInstanceOf(InputValidationError);
      // The stored hash is unchanged.
      const user = await getUserByEmail(db, 'a@example.com');
      expect(verifyPassword('origPass1', user!.passwordHash)).toBe(true);
    });

    it('rejects a too-short new password', async () => {
      await expect(
        changePassword(db, 'prn_a', 'a@example.com', { currentPassword: 'origPass1', newPassword: 'short' }),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('rejects when the principal does not own the email (defense in depth)', async () => {
      await expect(
        changePassword(db, 'prn_other', 'a@example.com', { currentPassword: 'origPass1', newPassword: 'brandnew12' }),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('changes the password on the happy path', async () => {
      await changePassword(db, 'prn_a', 'a@example.com', { currentPassword: 'origPass1', newPassword: 'brandnew12' });
      const user = await getUserByEmail(db, 'a@example.com');
      expect(verifyPassword('brandnew12', user!.passwordHash)).toBe(true);
      expect(verifyPassword('origPass1', user!.passwordHash)).toBe(false);
    });
  });

  describe('updateProfile', () => {
    beforeEach(() => seedHuman(db, { id: 'prn_a', email: 'a@example.com', password: 'origPass1', name: 'Ada' }));

    it('rejects an email already used by another principal', async () => {
      await seedHuman(db, { id: 'prn_b', email: 'b@example.com', password: 'p', name: 'Beth' });
      await expect(
        updateProfile(db, 'prn_b', { displayName: 'Beth', email: 'a@example.com' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('updates name + email, normalizing the email', async () => {
      const res = await updateProfile(db, 'prn_a', { displayName: '  New Ada  ', email: '  NEW@Example.COM ' });
      expect(res).toEqual({ displayName: 'New Ada', email: 'new@example.com' });
      const user = await getUserByEmail(db, 'new@example.com');
      expect(user?.displayName).toBe('New Ada');
      expect(user?.email).toBe('new@example.com');
    });

    it('allows re-saving the same email (self is not a conflict)', async () => {
      const res = await updateProfile(db, 'prn_a', { displayName: 'Ada Two', email: 'a@example.com' });
      expect(res.email).toBe('a@example.com');
      const user = await getUserByEmail(db, 'a@example.com');
      expect(user?.displayName).toBe('Ada Two');
    });

    it('rejects an invalid email', async () => {
      await expect(
        updateProfile(db, 'prn_a', { displayName: 'Ada', email: 'not-an-email' }),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('rejects an empty display name', async () => {
      await expect(
        updateProfile(db, 'prn_a', { displayName: '   ', email: 'a@example.com' }),
      ).rejects.toBeInstanceOf(InputValidationError);
    });
  });
});
