/**
 * Unlock-proof signing for password-protected share links (D51). The `rm_unlock`
 * cookie never carries the password or its hash directly — it carries an
 * expiry-bound HMAC-SHA256 proof: `${expSeconds}.${sig}`, where `sig` covers
 * `v1:share-unlock:${grantId}:${passwordHash}:${expSeconds}`, keyed by
 * `SESSION_SECRET` (Web Crypto, available in both Workers and the Node test
 * runtime).
 *
 * Binding the proof to the CURRENT password hash is deliberate: changing the
 * password (a new hash) or revoking the grant (the hash disappears entirely)
 * invalidates every outstanding cookie without an explicit revocation list. The
 * `v1:share-unlock:` prefix keeps this HMAC's message space disjoint from any
 * other use of `SESSION_SECRET` — a cookie forged for
 * one purpose can't be replayed as another. Binding `exp` INTO the signature
 * (not just the `Max-Age` cookie attribute) means the server itself enforces
 * expiry — a client can't extend its own session by re-presenting an old
 * cookie past its horizon; the `Max-Age` hint is only for browser bookkeeping.
 */

import { timingSafeEqualHex } from '@/lib/password';

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function computeSignature(secret: string, grantId: string, passwordHash: string, expSeconds: number): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v1:share-unlock:${grantId}:${passwordHash}:${expSeconds}`),
  );
  return toHex(sig);
}

/** Sign an unlock proof for `grantId` bound to its current password hash and an
 *  expiry horizon (`exp`, ISO-8601 — the maxAge horizon the caller computed).
 *  Returns the cookie value `${expSeconds}.${sig}`. */
export async function signUnlock(secret: string, grantId: string, passwordHash: string, exp: string): Promise<string> {
  const expSeconds = Math.floor(new Date(exp).getTime() / 1000);
  const sig = await computeSignature(secret, grantId, passwordHash, expSeconds);
  return `${expSeconds}.${sig}`;
}

/** Verify a presented unlock proof against the grant's CURRENT password hash.
 *  Rejects a malformed cookie, a bad signature, AND an expired one (`now` >
 *  the embedded `exp`) — the server enforces expiry itself rather than
 *  trusting the browser's `Max-Age`. */
export async function verifyUnlock(
  secret: string,
  grantId: string,
  passwordHash: string,
  presented: string,
  now: string,
): Promise<boolean> {
  if (!presented) return false;
  const dot = presented.indexOf('.');
  if (dot < 0) return false;
  const expPart = presented.slice(0, dot);
  const sigPart = presented.slice(dot + 1);
  if (!/^\d+$/.test(expPart)) return false;
  const expSeconds = Number(expPart);
  const nowSeconds = Math.floor(new Date(now).getTime() / 1000);
  if (nowSeconds > expSeconds) return false;
  const expected = await computeSignature(secret, grantId, passwordHash, expSeconds);
  return timingSafeEqualHex(expected, sigPart);
}
