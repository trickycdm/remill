/**
 * Password hashing for human credentials, using @noble/hashes/scrypt (RFC 7914)
 * with a random per-password salt. Stored format: `<saltHex>:<hashHex>`.
 * See steering/SECURITY_STANDARDS.md.
 *
 * Params balance security against the Workers CPU budget:
 *   N=16384 (2^14) — lower than the 2^18 desktop guidance, tuned for interactive
 *   login inside a Worker; r=8, p=1 standard; dkLen=32 (256-bit output).
 *
 * NOTE: machine bearer tokens are NOT hashed here — they are high-entropy random
 * strings hashed with SHA-256 at the token layer (Phase 6), not scrypt.
 */

import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Hash a plaintext password with scrypt + random salt → `saltHex:hashHex`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scrypt(new TextEncoder().encode(password), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: KEY_LENGTH,
  });
  return `${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

/** Verify a plaintext password against a stored `saltHex:hashHex`. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = hexToBytes(saltHex);
  const hash = scrypt(new TextEncoder().encode(password), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: KEY_LENGTH,
  });

  return timingSafeEqualHex(bytesToHex(hash), hashHex);
}

/** Constant-time hex string comparison to avoid leaking match progress by timing.
 *  Exported — `share-unlock.ts` (D51) reuses this instead of a second hand-copy. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
