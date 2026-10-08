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

/**
 * D60: migration 0019 widens the `render_mode` CHECK to admit 'frame' by
 * swapping the column — NOT by rebuilding `collections`, whose drop would
 * cascade through `documents.collection` and delete every document. Simulate an
 * install with content, then apply it.
 */
describe('migration 0019 — frame render mode without losing documents (D60)', () => {
  const MIGRATIONS = join(import.meta.dirname, 'migrations');
  const run = (db: InstanceType<typeof Database>, file: string) => {
    for (const stmt of readFileSync(join(MIGRATIONS, file), 'utf-8').split('--> statement-breakpoint')) {
      if (stmt.trim()) db.exec(stmt);
    }
  };
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const d60 = files.find((f) => f.startsWith('0019_'))!;

  const installWithContent = () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const f of files.filter((f) => f < d60)) run(db, f);
    const now = '2026-10-04T00:00:00Z';
    const collection = db.prepare(
      "INSERT INTO collections (slug, name, shape, fields_json, render_mode, created_at, updated_at) VALUES (?, ?, 'collection', '[]', ?, ?, ?)",
    );
    collection.run('reports', 'Reports', 'raw', now, now);
    collection.run('notes', 'Notes', null, now, now);
    const doc = db.prepare(
      "INSERT INTO documents (id, collection, data_json, status, created_at, updated_at) VALUES (?, ?, '{}', 'published', ?, ?)",
    );
    doc.run('doc_r1', 'reports', now, now);
    doc.run('doc_n1', 'notes', now, now);
    return db;
  };

  it('keeps every document and every existing render mode', () => {
    const db = installWithContent();
    run(db, d60);
    expect(db.prepare('SELECT id FROM documents ORDER BY id').all()).toEqual([{ id: 'doc_n1' }, { id: 'doc_r1' }]);
    expect(db.prepare('SELECT slug, render_mode FROM collections ORDER BY slug').all()).toEqual([
      { slug: 'notes', render_mode: null },
      { slug: 'reports', render_mode: 'raw' },
    ]);
  });

  it("admits 'frame' and still rejects an unknown mode", () => {
    const db = installWithContent();
    run(db, d60);
    db.prepare("UPDATE collections SET render_mode = 'frame' WHERE slug = 'reports'").run();
    expect(db.prepare("SELECT render_mode FROM collections WHERE slug = 'reports'").get()).toEqual({ render_mode: 'frame' });
    expect(() => db.prepare("UPDATE collections SET render_mode = 'bogus' WHERE slug = 'notes'").run()).toThrow(/CHECK/);
    // The documents FK still points at the (never-rebuilt) parent.
    expect(() =>
      db
        .prepare("INSERT INTO documents (id, collection, data_json, status, created_at, updated_at) VALUES ('doc_x', 'nope', '{}', 'published', 'n', 'n')")
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

/**
 * D62: the built-in `pages` collection reaches a fresh install through seed.sql
 * and an EXISTING one through migration 0020 — two hand-mirrored copies of one
 * row, so they are compared here.
 */
describe('migration 0020 — the built-in pages collection (D62)', () => {
  const MIGRATIONS = join(import.meta.dirname, 'migrations');
  const SEED = readFileSync(join(import.meta.dirname, 'seed.sql'), 'utf-8');
  const run = (db: InstanceType<typeof Database>, file: string) => {
    for (const stmt of readFileSync(join(MIGRATIONS, file), 'utf-8').split('--> statement-breakpoint')) {
      if (stmt.trim()) db.exec(stmt);
    }
  };
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const d62 = files.find((f) => f.startsWith('0020_'))!;
  const d63 = files.find((f) => f.startsWith('0021_'))!;
  const migrated = (upTo?: string) => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const f of files.filter((f) => !upTo || f < upTo)) run(db, f);
    return db;
  };
  /** The seed as it stood before D62: everything but the pages insert. */
  const seedWithoutPages = SEED.slice(0, SEED.indexOf("-- `pages` — collection, protected (D62)"));
  const pagesRow = (db: InstanceType<typeof Database>) =>
    db
      .prepare(
        "SELECT slug, name, shape, fields_json, workflow_json, access_json, protected, render_mode, template, bind_json FROM collections WHERE slug = 'pages'",
      )
      .get();

  it('adds pages to an install that was seeded before it existed', () => {
    const db = migrated(d62);
    db.exec(seedWithoutPages);
    expect(pagesRow(db)).toBeUndefined();
    run(db, d62);
    expect(pagesRow(db)).toMatchObject({ slug: 'pages', protected: 1, render_mode: 'frame' });
  });

  it('the migration row and the seed row are the same row (0020 then 0021, D63)', () => {
    const viaMigration = migrated(d62);
    viaMigration.exec(seedWithoutPages);
    run(viaMigration, d62);
    run(viaMigration, d63);
    const viaSeed = migrated();
    viaSeed.exec(SEED);
    expect(pagesRow(viaMigration)).toEqual(pagesRow(viaSeed));
  });

  it('leaves a migrations-only database alone (the seed brings the row)', () => {
    expect(pagesRow(migrated())).toBeUndefined();
  });

  it('never overwrites a collection someone already made at that slug', () => {
    const db = migrated(d62);
    db.exec(seedWithoutPages);
    db.prepare(
      "INSERT INTO collections (slug, name, shape, fields_json, created_at, updated_at) VALUES ('pages', 'My pages', 'collection', '[]', 'n', 'n')",
    ).run();
    run(db, d62);
    db.exec(SEED);
    expect(pagesRow(db)).toMatchObject({ name: 'My pages', protected: 0, render_mode: null });
  });
});

/**
 * D63: migration 0021 widens the CHECK again (the same column swap as 0019)
 * and moves the BUILT-IN pages collection from frame to inline — and nothing
 * else.
 */
describe('migration 0021 — inline render mode (D63)', () => {
  const MIGRATIONS = join(import.meta.dirname, 'migrations');
  const SEED = readFileSync(join(import.meta.dirname, 'seed.sql'), 'utf-8');
  const run = (db: InstanceType<typeof Database>, file: string) => {
    for (const stmt of readFileSync(join(MIGRATIONS, file), 'utf-8').split('--> statement-breakpoint')) {
      if (stmt.trim()) db.exec(stmt);
    }
  };
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const d63 = files.find((f) => f.startsWith('0021_'))!;
  const beforeD63 = () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const f of files.filter((f) => f < d63)) run(db, f);
    return db;
  };
  const now = '2026-10-08T00:00:00Z';

  it('moves the built-in pages collection to inline, keeping its documents', () => {
    const db = beforeD63();
    db.exec(SEED.replace("  'inline',\n", "  'frame',\n"));
    db.prepare(
      "INSERT INTO documents (id, collection, data_json, status, created_at, updated_at) VALUES ('doc_p1', 'pages', '{}', 'published', ?, ?)",
    ).run(now, now);
    expect(db.prepare("SELECT render_mode FROM collections WHERE slug = 'pages'").get()).toEqual({ render_mode: 'frame' });
    run(db, d63);
    const row = db.prepare("SELECT render_mode, fields_json FROM collections WHERE slug = 'pages'").get() as {
      render_mode: string;
      fields_json: string;
    };
    expect(row.render_mode).toBe('inline');
    expect(row.fields_json).toContain('shown in place inside the viewer');
    expect(row.fields_json).not.toContain('sandboxed frame');
    expect(db.prepare('SELECT id FROM documents').all()).toEqual([{ id: 'doc_p1' }]);
  });

  it("leaves other collections' modes alone, and a user's own pages collection", () => {
    const db = beforeD63();
    const collection = db.prepare(
      "INSERT INTO collections (slug, name, shape, fields_json, render_mode, created_at, updated_at) VALUES (?, ?, 'collection', '[]', ?, ?, ?)",
    );
    collection.run('pages', 'My pages', 'frame', now, now);
    collection.run('reports', 'Reports', 'raw', now, now);
    run(db, d63);
    expect(db.prepare('SELECT slug, render_mode FROM collections ORDER BY slug').all()).toEqual([
      { slug: 'pages', render_mode: 'frame' },
      { slug: 'reports', render_mode: 'raw' },
    ]);
  });

  it("admits 'inline' and still rejects an unknown mode", () => {
    const db = beforeD63();
    db.prepare(
      "INSERT INTO collections (slug, name, shape, fields_json, created_at, updated_at) VALUES ('notes', 'Notes', 'collection', '[]', ?, ?)",
    ).run(now, now);
    run(db, d63);
    db.prepare("UPDATE collections SET render_mode = 'inline' WHERE slug = 'notes'").run();
    expect(db.prepare("SELECT render_mode FROM collections WHERE slug = 'notes'").get()).toEqual({ render_mode: 'inline' });
    expect(() => db.prepare("UPDATE collections SET render_mode = 'bogus' WHERE slug = 'notes'").run()).toThrow(/CHECK/);
  });
});
