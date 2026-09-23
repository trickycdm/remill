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

// The `articles` collection the public-reading spec drives: templated with the
// 'article' reading template and publicRead so anonymous readers resolve it. Its
// field shape is co-designed for the template (hero media, excerpt dek, tags).
// Seeded via raw SQL because the admin collection builder has no template picker
// yet (deferred) — `template` is a column, set directly here.
const ARTICLES_FIELDS_JSON = JSON.stringify([
  { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
  { key: 'slug', type: 'slug', config: { from: 'title' }, index: true },
  { key: 'hero', type: 'media' },
  { key: 'excerpt', type: 'text' },
  { key: 'body', type: 'markdown' },
  { key: 'tags', type: 'tags', index: true },
]);
const ARTICLES_WORKFLOW_JSON = JSON.stringify({ draftPublish: true });
const ARTICLES_ACCESS_JSON = JSON.stringify({ publicRead: true });

// The `reports` collection the document-review spec drives (D55): an `html`
// field (rich pages with figures — the block-comment case) plus a markdown
// summary, rendered through the generic shell. Not publicRead: reviewers reach
// it through review links, the owner through preview.
const REPORTS_FIELDS_JSON = JSON.stringify([
  { key: 'title', type: 'text', required: true, admin: { showInList: true } },
  { key: 'summary', type: 'markdown' },
  { key: 'page', type: 'html' },
]);

// A media row the seeded article references as its hero. No R2 object is needed —
// the reading spec asserts the <img> alt + placement, not the bytes.
const HERO_MEDIA_ID = 'med_e2ehero00000000';
const HERO_ALT = 'E2E hero image';

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
    // `articles` collection — templated ('article'), publicRead.
    `INSERT OR IGNORE INTO collections (slug, name, shape, fields_json, workflow_json, access_json, protected, template, created_at, updated_at) VALUES (` +
      `'articles', 'Articles', 'collection', ${sqlString(ARTICLES_FIELDS_JSON)}, ${sqlString(ARTICLES_WORKFLOW_JSON)}, ${sqlString(ARTICLES_ACCESS_JSON)}, 0, 'article', ${sqlString(CREATED_AT)}, ${sqlString(CREATED_AT)});`,
    // `reports` collection — html + markdown, for document review (D55).
    `INSERT OR IGNORE INTO collections (slug, name, shape, fields_json, workflow_json, access_json, protected, created_at, updated_at) VALUES (` +
      `'reports', 'Reports', 'collection', ${sqlString(REPORTS_FIELDS_JSON)}, NULL, NULL, 0, ${sqlString(CREATED_AT)}, ${sqlString(CREATED_AT)});`,
    // Hero media row for the seeded article (no R2 object needed).
    `INSERT OR IGNORE INTO media (id, r2_key, filename, mime, size, width, height, duration, alt, variants_json, created_by, created_at) VALUES (` +
      `${sqlString(HERO_MEDIA_ID)}, 'e2e/hero', 'hero.png', 'image/png', 1024, 1200, 630, NULL, ${sqlString(HERO_ALT)}, NULL, NULL, ${sqlString(CREATED_AT)});`,
    // Seeded author human (assigned the system `author` role).
    `INSERT OR IGNORE INTO principals (id, kind, subtype, name, disabled, created_at) VALUES (${sqlString(AUTHOR_PRINCIPAL_ID)}, 'user', 'person', 'Author', 0, ${sqlString(CREATED_AT)});`,
    `INSERT OR IGNORE INTO users (principal_id, email, password_hash, created_at) VALUES (${sqlString(AUTHOR_PRINCIPAL_ID)}, ${sqlString(AUTHOR_EMAIL)}, ${sqlString(passwordHash)}, ${sqlString(CREATED_AT)});`,
    `INSERT OR IGNORE INTO principal_roles (id, principal_id, role, collection) VALUES (${sqlString(AUTHOR_ROLE_ASSIGNMENT_ID)}, ${sqlString(AUTHOR_PRINCIPAL_ID)}, 'author', '*');`,
  ].join('\n');

  try {
    execFileSync('wrangler', ['d1', 'execute', 'remill', '--local', '--command', sql], { stdio: 'inherit' });
  } catch {
    console.error('seed-e2e: wrangler execution failed. SQL was:\n' + sql);
    process.exit(1);
  }

  console.log(
    `\ne2e fixtures seeded on local D1: 'posts' + 'articles' (templated) + 'reports' collections, a hero media row + ${AUTHOR_EMAIL}.`,
  );
}

main();
