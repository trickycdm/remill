/**
 * Bearer-token generation + hashing (steering/SECURITY_STANDARDS.md). Tokens are
 * high-entropy random strings; only their SHA-256 hash is stored (never the
 * plaintext). The plaintext is shown to the issuer exactly once. Uses Web Crypto,
 * available in both Workers and the Node test runtime.
 */

const TOKEN_PREFIX = 'rmk_'; // "remill key" — helps humans/scanners recognise it

/** Generate a new opaque token (returned to the caller once, never stored). */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return TOKEN_PREFIX + base64url(bytes);
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
