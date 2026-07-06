/**
 * Bearer-token generation + hashing (steering/SECURITY_STANDARDS.md). Tokens are
 * high-entropy random strings; only their SHA-256 hash is stored (never the
 * plaintext). The plaintext is shown to the issuer exactly once. Uses Web Crypto,
 * available in both Workers and the Node test runtime.
 */

const TOKEN_PREFIX = 'rmk_'; // "remill key" — helps humans/scanners recognise it
const SHARE_TOKEN_PREFIX = 'rms_'; // "remill share" — a link token, never an API key

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + base64url(bytes);
}

/** Generate a new opaque API token (returned to the caller once, never stored). */
export function generateToken(): string {
  return randomToken(TOKEN_PREFIX);
}

/** Generate a share-link token (C3) — same entropy/hashing as API tokens, but a
 *  distinct prefix so a leaked link can never be mistaken for a bearer key. */
export function generateShareToken(): string {
  return randomToken(SHARE_TOKEN_PREFIX);
}

/** SHA-256 hex hash of a token, for storage and constant-time-ish lookup. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
