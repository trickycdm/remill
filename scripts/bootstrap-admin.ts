/**
 * Provision the FIRST admin — the credential bootstrap that replaces the old,
 * insecure default-credential seed (C1). No password hash is ever committed to the
 * repo: the password is supplied by the operator (`ADMIN_BOOTSTRAP_PASSWORD`) or
 * generated here and printed exactly once, then hashed with scrypt at run time.
 *
 * Usage:
 *   bun run db:bootstrap:local          # local D1; dev password 'remilladmin' if unset
 *   bun run db:bootstrap:remote         # production D1; requires a strong password
 *
 *   ADMIN_BOOTSTRAP_EMAIL=you@site.com \
 *   ADMIN_BOOTSTRAP_PASSWORD='…strong…' \
 *   bun run db:bootstrap:remote
 *
 * Against --remote we REFUSE a weak or the well-known dev password: production must
 * never boot with guessable admin credentials. If no password is given for --remote
 * a strong random one is generated and printed once. Rotate/reset on first login.
 */

import { execFileSync } from 'node:child_process';
import { hashPassword } from '@/lib/password';

const DEV_PASSWORD = 'remilladmin'; // local-only convenience; matches e2e fixtures.
const MIN_REMOTE_PASSWORD_LEN = 16;

const ADMIN_PRINCIPAL_ID = 'prn_admin0000000000000';
const ADMIN_ROLE_ASSIGNMENT_ID = 'pnr_admin0000000000000';
const CREATED_AT = new Date().toISOString();

function fail(message: string): never {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

/** A high-entropy random password (base64url of 18 bytes ≈ 24 chars). */
function generatePassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function main(): void {
  const remote = process.argv.includes('--remote');
  const target = remote ? '--remote' : '--local';

  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@remill.local').trim().toLowerCase();

  let password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  let generated = false;

  if (remote) {
    if (!password) {
      password = generatePassword();
      generated = true;
    }
    if (password === DEV_PASSWORD || password.length < MIN_REMOTE_PASSWORD_LEN) {
      fail(
        `refusing to bootstrap PRODUCTION with a weak/known password. ` +
          `Set ADMIN_BOOTSTRAP_PASSWORD to at least ${MIN_REMOTE_PASSWORD_LEN} chars, or unset it to auto-generate one.`,
      );
    }
  } else if (!password) {
    password = DEV_PASSWORD; // local dev convenience only.
    console.warn(`bootstrap-admin: using the well-known dev password for --local. NEVER use this remotely.`);
  }

  const passwordHash = hashPassword(password);

  // INSERT OR IGNORE keeps this idempotent — re-running does not clobber an existing
  // admin's password. Only the scrypt hash is stored, never the plaintext.
  const sql = [
    `INSERT OR IGNORE INTO principals (id, kind, name, disabled, created_at) VALUES (${sqlString(ADMIN_PRINCIPAL_ID)}, 'user', 'Administrator', 0, ${sqlString(CREATED_AT)});`,
    `INSERT OR IGNORE INTO users (principal_id, email, password_hash, created_at) VALUES (${sqlString(ADMIN_PRINCIPAL_ID)}, ${sqlString(email)}, ${sqlString(passwordHash)}, ${sqlString(CREATED_AT)});`,
    `INSERT OR IGNORE INTO principal_roles (id, principal_id, role, collection) VALUES (${sqlString(ADMIN_ROLE_ASSIGNMENT_ID)}, ${sqlString(ADMIN_PRINCIPAL_ID)}, 'admin', '*');`,
  ].join('\n');

  try {
    execFileSync('wrangler', ['d1', 'execute', 'remill', target, '--command', sql], { stdio: 'inherit' });
  } catch {
    console.error('bootstrap-admin: wrangler execution failed. Run the SQL above manually if needed:\n' + sql);
    process.exit(1);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`Admin bootstrapped on ${target === '--remote' ? 'PRODUCTION' : 'local'} D1.`);
  console.log(`  email:    ${email}`);
  if (generated || target === '--local') {
    console.log(`  password: ${password}${generated ? '  (generated — shown once)' : ''}`);
  } else {
    console.log(`  password: (the one you provided)`);
  }
  console.log('  Change this password immediately after first login.');
  console.log('──────────────────────────────────────────────────────────\n');
}

main();
