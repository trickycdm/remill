/**
 * Reversible encryption for share-link tokens (D53). Share links stay
 * *copyable* after creation — like a Google Docs share link — so the plaintext
 * is stored as AES-GCM-256 ciphertext (`item_grants.token_enc`) alongside the
 * existing SHA-256 lookup hash (`subject_id`, unchanged). The hash is what
 * `authorize()` matches against; this ciphertext exists ONLY so the Share
 * panel can re-display the URL later.
 *
 * The AES-GCM key is derived from `SESSION_SECRET` via HKDF-SHA256 with a
 * fixed salt and an `info` string that domain-separates it from every other
 * use of that secret (share-unlock.ts's HMAC, session cookies, …) — a key
 * derived for this purpose can't be replayed as another. Web Crypto only, so
 * this runs identically in Workers and the Node test runner.
 *
 * Format: `v1.<base64url iv>.<base64url ciphertext>` — versioned so a future
 * scheme change can coexist with rows encrypted under `v1`.
 */

import { base64url } from '@/lib/token';

const VERSION = 'v1';
const HKDF_INFO = 'remill:share-link-token:v1';
// HKDF salts don't need to be secret, only fixed and unique to this
// derivation — a static value keeps the derivation deterministic per secret.
const HKDF_SALT = new TextEncoder().encode('remill:share-token-crypto:hkdf-salt');
const IV_LENGTH = 12; // AES-GCM standard nonce size

async function deriveKey(secret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(HKDF_INFO) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encrypt a plaintext share-link token for storage in `token_enc`. Random
 *  12-byte IV per call, so encrypting the same token twice never produces the
 *  same ciphertext. */
export async function encryptToken(secret: string, token: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return `${VERSION}.${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

/** Decrypt a `token_enc` value back to its plaintext token. Returns null on
 *  any failure — wrong secret, tampered ciphertext, malformed input, or an
 *  unknown version — never throws (the Share panel treats null as "can't be
 *  shown again", not an error). */
export async function decryptToken(secret: string, enc: string): Promise<string | null> {
  const parts = enc.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, ivPart, ciphertextPart] = parts;
  try {
    const key = await deriveKey(secret);
    const iv = base64urlToBytes(ivPart);
    const ciphertext = base64urlToBytes(ciphertextPart);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
