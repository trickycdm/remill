/**
 * Dev utility: print a scrypt password hash in the stored `saltHex:hashHex` format
 * for seeding or manual account creation. Uses the same params as
 * src/lib/password.ts so hashes verify against it.
 *
 * Usage:  bun run scripts/hash-password.ts '<plaintext>'
 */
import { hashPassword } from '@/lib/password';

const pw = process.argv[2];
if (!pw) {
  console.error("usage: bun run scripts/hash-password.ts '<plaintext>'");
  process.exit(1);
}
console.log(hashPassword(pw));
