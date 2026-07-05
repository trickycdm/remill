/**
 * Seed the e2e-only fixtures the Playwright suite assumes exist: a `posts`
 * collection and a seeded `author@remill.local` human. These are NOT part of the
 * production seed (`src/db/seed.sql` is system-data-only, C1) — they are test
 * fixtures, so they live here and are applied by `bun run e2e` against --local D1.
 *
 * Idempotent (fixed IDs + INSERT OR IGNORE). Local only: the author password is the
 * well-known dev password and must never be pushed to a remote DB. Requires the DB
 * to be migrated first (`bun run db:migrate`).
 *
 *   bun run scripts/seed-e2e.ts        # --local D1
 */

import { execFileSync } from 'node:child_process';
import { hashPassword } from '@/lib/password';

const CREATED_AT = new Date().toISOString();

const AUTHOR_PRINCIPAL_ID = 'prn_e2eauthor00000000';
const AUTHOR_ROLE_ASSIGNMENT_ID = 'pnr_e2eauthor00000000';
const AUTHOR_EMAIL = 'author@remill.local';
const AUTHOR_PASSWORD = 'authorpass'; // dev-only; matches e2e/admin-schema-access.spec.ts.

// The `posts` collection the content-admin specs drive. `slug` derives from
// `title`; `draftPublish` makes new docs start as drafts so the lifecycle test can
// exercise draft → publish. Keep field shapes in sync with the specs' getByLabel().
const POSTS_FIELDS_JSON = JSON.stringify([
  { key: 'title', type: 'text', required: true, admin: { showInList: true } },
  { key: 'slug', type: 'slug', config: { from: 'title' }, admin: { showInList: true } },
  { key: 'body', type: 'markdown' },
]);
const POSTS_WORKFLOW_JSON = JSON.stringify({ draftPublish: true });

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function main(): void {
  if (process.argv.includes('--remote')) {
    console.error('seed-e2e: refusing to run against --remote; these are local test fixtures only.');
    process.exit(1);
  }

  const passwordHash = hashPassword(AUTHOR_PASSWORD);

  const sql = [
    // `posts` collection.
    `INSERT OR IGNORE INTO collections (slug, name, shape, fields_json, workflow_json, access_json, protected, created_at, updated_at) VALUES (` +
      `'posts', 'Posts', 'collection', ${sqlString(POSTS_FIELDS_JSON)}, ${sqlString(POSTS_WORKFLOW_JSON)}, NULL, 0, ${sqlString(CREATED_AT)}, ${sqlString(CREATED_AT)});`,
    // Seeded author human (assigned the system `author` role).
    `INSERT OR IGNORE INTO principals (id, kind, name, disabled, created_at) VALUES (${sqlString(AUTHOR_PRINCIPAL_ID)}, 'user', 'Author', 0, ${sqlString(CREATED_AT)});`,
    `INSERT OR IGNORE INTO users (principal_id, email, password_hash, created_at) VALUES (${sqlString(AUTHOR_PRINCIPAL_ID)}, ${sqlString(AUTHOR_EMAIL)}, ${sqlString(passwordHash)}, ${sqlString(CREATED_AT)});`,
    `INSERT OR IGNORE INTO principal_roles (id, principal_id, role, collection) VALUES (${sqlString(AUTHOR_ROLE_ASSIGNMENT_ID)}, ${sqlString(AUTHOR_PRINCIPAL_ID)}, 'author', '*');`,
  ].join('\n');

  try {
    execFileSync('wrangler', ['d1', 'execute', 'remill', '--local', '--command', sql], { stdio: 'inherit' });
  } catch {
    console.error('seed-e2e: wrangler execution failed. SQL was:\n' + sql);
    process.exit(1);
  }

  console.log(`\ne2e fixtures seeded on local D1: 'posts' collection + ${AUTHOR_EMAIL}.`);
}

main();
