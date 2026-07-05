/**
 * In-memory D1Database adapter for Vitest, backed by better-sqlite3 (synchronous
 * SQLite, zero startup). Implements the slice of the D1Database interface that
 * drizzle-orm/d1 actually calls (prepare→bind, batch, exec), so all real query
 * code runs unchanged. Miniflare would need a workerd subprocess per file —
 * impractical for fast unit tests. See steering/TESTING_AND_VERIFICATION.md.
 */
import Database from 'better-sqlite3';
import type {
  Statement as BetterSqliteStatement,
  Database as BetterSqliteDatabase,
} from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from '@/lib/password';

interface D1Meta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

function isWriteStatement(sql: string): boolean {
  const upper = sql.trimStart().toUpperCase();
  return (
    upper.startsWith('INSERT') ||
    upper.startsWith('UPDATE') ||
    upper.startsWith('DELETE') ||
    upper.startsWith('CREATE') ||
    upper.startsWith('DROP') ||
    upper.startsWith('ALTER')
  );
}

class BoundStatement {
  readonly sql: string;

  constructor(
    private readonly stmt: BetterSqliteStatement,
    private readonly params: unknown[],
    sql: string,
  ) {
    this.sql = sql;
  }

  all(): D1Result {
    if (isWriteStatement(this.sql)) {
      const info = this.stmt.run(...this.params);
      return { results: [], success: true, meta: writeMeta(info) };
    }
    const rows = this.stmt.all(...this.params) as Record<string, unknown>[];
    return { results: rows, success: true, meta: emptyMeta() };
  }

  run(): D1Result {
    const info = this.stmt.run(...this.params);
    return { results: [], success: true, meta: writeMeta(info) };
  }

  raw(): unknown[][] {
    const raw = (this.stmt as BetterSqliteStatement).raw();
    return raw.all(...this.params) as unknown[][];
  }

  first(): Record<string, unknown> | null {
    const rows = this.stmt.all(...this.params) as Record<string, unknown>[];
    return rows[0] ?? null;
  }
}

class D1PreparedStatementAdapter {
  constructor(
    private readonly bsdb: BetterSqliteDatabase,
    private readonly sqlStr: string,
  ) {}

  bind(...params: unknown[]): BoundStatement {
    const stmt = this.bsdb.prepare(this.sqlStr);
    return new BoundStatement(stmt, params, this.sqlStr);
  }
}

class D1DatabaseAdapter {
  constructor(private readonly bsdb: BetterSqliteDatabase) {}

  prepare(sql: string): D1PreparedStatementAdapter {
    return new D1PreparedStatementAdapter(this.bsdb, sql);
  }

  async batch(statements: BoundStatement[]): Promise<D1Result[]> {
    // D1 batch is atomic; better-sqlite3 transaction gives the same all-or-nothing.
    const run = this.bsdb.transaction((stmts: BoundStatement[]) => stmts.map((s) => s.all()));
    return run(statements);
  }

  async exec(sql: string): Promise<D1Result> {
    this.bsdb.exec(sql);
    return { results: [], success: true, meta: emptyMeta() };
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

function emptyMeta(): D1Meta {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  };
}

function writeMeta(info: { changes: number; lastInsertRowid: number | bigint }): D1Meta {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: info.changes,
    last_row_id: Number(info.lastInsertRowid),
    changed_db: info.changes > 0,
    changes: info.changes,
  };
}

const MIGRATIONS_DIR = join(import.meta.dirname, '../db/migrations');

function applyMigrations(bsdb: BetterSqliteDatabase): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('meta'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      bsdb.exec(stmt);
    }
  }
}

const SEED_FILE = join(import.meta.dirname, '../db/seed.sql');

// Dev-admin fixture. seed.sql no longer ships credentials (C1); production creates
// the admin via scripts/bootstrap-admin.ts. Tests still need a known admin login, so
// we compute its hash HERE at run time from a dev password — no hash is committed.
const DEV_ADMIN_PRINCIPAL_ID = 'prn_admin0000000000000';
const DEV_ADMIN_EMAIL = 'admin@remill.local';
const DEV_ADMIN_PASSWORD = 'remilladmin';

function seedDevAdmin(bsdb: BetterSqliteDatabase): void {
  const hash = hashPassword(DEV_ADMIN_PASSWORD); // saltHex:hashHex — safe to inline.
  const now = '2026-07-04T00:00:00Z';
  bsdb.exec(
    `INSERT OR IGNORE INTO principals (id, kind, name, disabled, created_at) VALUES ('${DEV_ADMIN_PRINCIPAL_ID}', 'user', 'Administrator', 0, '${now}');
     INSERT OR IGNORE INTO users (principal_id, email, password_hash, created_at) VALUES ('${DEV_ADMIN_PRINCIPAL_ID}', '${DEV_ADMIN_EMAIL}', '${hash}', '${now}');
     INSERT OR IGNORE INTO principal_roles (id, principal_id, role, collection) VALUES ('pnr_admin0000000000000', '${DEV_ADMIN_PRINCIPAL_ID}', 'admin', '*');`,
  );
}

/**
 * Create a fresh in-memory D1Database with the app schema applied. Isolated per
 * call. Pass `{ seed: true }` to also apply src/db/seed.sql (system roles + the two
 * protected collections) plus the dev-admin fixture (see above).
 */
export function createTestD1(opts: { seed?: boolean } = {}): D1Database {
  const bsdb = new Database(':memory:');
  bsdb.pragma('journal_mode = WAL');
  bsdb.pragma('foreign_keys = ON');
  applyMigrations(bsdb);
  if (opts.seed) {
    bsdb.exec(readFileSync(SEED_FILE, 'utf-8'));
    seedDevAdmin(bsdb);
  }
  return new D1DatabaseAdapter(bsdb) as unknown as D1Database;
}
