import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C1: the committed production seed (run against prod by `db:seed:remote`) must
 * never provision a usable default-credential admin. The first admin is created out
 * of band with an explicit password by scripts/bootstrap-admin.ts. This guards the
 * exact hole from the review — a known scrypt hash for a known plaintext, shipped in
 * the repo — from ever coming back.
 */
describe('seed.sql — no committed admin credentials (C1)', () => {
  const seedSql = readFileSync(join(import.meta.dirname, '../db/seed.sql'), 'utf-8');

  it('ships no admin login: no users insert, no email, no password hash', () => {
    expect(seedSql).not.toMatch(/INSERT[\s\S]*INTO\s+users/i);
    expect(seedSql).not.toContain('admin@remill.local');
    expect(seedSql).not.toContain('password_hash');
    // The specific committed hash named in the finding is gone.
    expect(seedSql).not.toContain('cc81123b2cb4b87287c00c60e550a5ff');
    expect(seedSql).not.toContain('remilladmin');
  });

  it('still seeds the system roles + the two protected collections', () => {
    expect(seedSql).toMatch(/INSERT[\s\S]*INTO\s+roles/i);
    expect(seedSql).toContain("'settings'");
    expect(seedSql).toContain("'media'");
  });
});
