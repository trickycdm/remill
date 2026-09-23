import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { SYSTEM_ROLES } from '@/access/policy';

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

  /**
   * DRIFT GUARD (D26): the system-role policy lives in THREE hand-mirrored
   * places — ACTIONS (types.ts), SYSTEM_ROLES (policy.ts, seeds tests), and
   * seed.sql (seeds production). Tests exercise policy.ts while prod runs
   * seed.sql, so silent divergence would ship untested permissions. Assert
   * every policy permission has a matching seed row.
   */
  it('every SYSTEM_ROLES permission has a matching role_permissions row in seed.sql', () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) {
        const condition = p.condition ? `'${p.condition}'` : 'NULL';
        // ('rlp_…','<role>', '<collection>', '<action>', <condition>) with flexible spacing
        const row = new RegExp(
          `\\('rlp_[a-z_]+',\\s*'${role.slug}',\\s*'\\${p.collection}',\\s*'${p.action}',\\s*${condition}\\)`,
        );
        expect(seedSql, `seed.sql is missing: ${role.slug} ${p.collection} ${p.action} ${condition}`).toMatch(row);
      }
    }
  });
});

/**
 * D55: production applies migrations but never re-runs seed.sql, so the
 * `comment` permission reaches EXISTING installs only through migration 0017.
 * Simulate an install that predates it: every earlier migration, then the
 * seed as it stood (roles present, no comment rows), then 0017.
 */
describe('migration 0017 — comment permission for existing installs (D55)', () => {
  const MIGRATIONS = join(import.meta.dirname, 'migrations');
  const run = (db: InstanceType<typeof Database>, file: string) => {
    for (const stmt of readFileSync(join(MIGRATIONS, file), 'utf-8').split('--> statement-breakpoint')) {
      if (stmt.trim()) db.exec(stmt);
    }
  };
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const d55 = files.find((f) => f.startsWith('0017_'))!;

  it('adds the comment rows when the system roles already exist', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const f of files.filter((f) => f < d55)) run(db, f);
    const seedWithoutComment = readFileSync(join(import.meta.dirname, 'seed.sql'), 'utf-8')
      .split('\n')
      .filter((l) => !l.includes("'comment'"))
      .join('\n');
    db.exec(seedWithoutComment);
    run(db, d55);
    const rows = db
      .prepare("SELECT role, condition FROM role_permissions WHERE action = 'comment' ORDER BY role")
      .all();
    expect(rows).toEqual([
      { role: 'admin', condition: null },
      { role: 'author', condition: 'own' },
      { role: 'editor', condition: null },
    ]);
  });

  it('is a no-op on a fresh database (seed.sql adds the rows after the roles)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const f of files) run(db, f);
    expect(db.prepare("SELECT COUNT(*) AS n FROM role_permissions WHERE action = 'comment'").get()).toEqual({ n: 0 });
  });
});
