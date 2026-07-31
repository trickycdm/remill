/**
 * OAuth 2.1 pure helpers (D48): PKCE S256 verification, redirect-URI
 * validation/matching, device-pairing user codes, and the wire shapes the
 * routes need (error bodies, WWW-Authenticate). No DB access — everything
 * stateful lives in src/services/oauth/.
 *
 * Spec map: PKCE RFC 7636 · native-app redirects RFC 8252 §7.3 · DCR RFC 7591
 * · device grant RFC 8628 · bearer challenge RFC 9728 §5.
 */

import { base64url } from '@/lib/token';

// --- PKCE ------------------------------------------------------------------

/** RFC 7636 §4.1 — verifiers are 43–128 chars of the unreserved set. */
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** S256 transform: base64url(SHA-256(ascii(verifier))). */
export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Verify a token-request `code_verifier` against the stored S256 challenge.
 *  Malformed verifiers fail closed — no exception path a caller could skip. */
export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (!PKCE_VERIFIER_RE.test(verifier)) return false;
  return (await pkceChallengeFromVerifier(verifier)) === challenge;
}

// --- Redirect URIs ---------------------------------------------------------

/** Schemes that must never be redirect targets, even as "custom schemes". */
const FORBIDDEN_SCHEMES = new Set(['http:', 'https:', 'javascript:', 'data:', 'file:', 'blob:']);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname === '::1' ? '[::1]' : url.hostname);
}

/**
 * Registration-time validation of one redirect URI (RFC 7591 + OAuth 2.1):
 * https anywhere; plain http only on loopback (native apps, RFC 8252); any
 * other scheme allowed as a private-use scheme (vscode://…) unless it's a
 * browser-dangerous one. Fragments are never allowed (RFC 6749 §3.1.2).
 */
export function isValidRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash !== '') return false;
  if (url.protocol === 'https:') return url.hostname !== '' && !url.hostname.includes('*');
  if (url.protocol === 'http:') return isLoopback(url);
  // Private-use scheme (vscode:, cursor:, com.example.app:) — anything except
  // the web/browser schemes that would make the "redirect" executable content.
  return !FORBIDDEN_SCHEMES.has(url.protocol) && /^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(url.protocol);
}

/** Validate a DCR `redirect_uris` array: non-empty, every entry valid. */
export function validateRedirectUris(uris: unknown): string[] | null {
  if (!Array.isArray(uris) || uris.length === 0) return null;
  const out: string[] = [];
  for (const u of uris) {
    if (typeof u !== 'string' || !isValidRedirectUri(u)) return null;
    out.push(u);
  }
  return out;
}

/**
 * Authorize/token-time matching: exact string equality, except loopback http
 * URIs match on everything but the port (RFC 8252 §7.3 — native clients bind
 * an ephemeral port per run).
 */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true;
  let a: URL, b: URL;
  try {
    a = new URL(registered);
    b = new URL(presented);
  } catch {
    return false;
  }
  if (a.protocol !== 'http:' || b.protocol !== 'http:') return false;
  if (!isLoopback(a) || !isLoopback(b)) return false;
  return (
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    a.username === '' &&
    b.username === ''
  );
}

// --- Device-pairing user codes ---------------------------------------------

/** Unambiguous alphabet (no vowels → no words; no 0/O/1/I lookalikes). */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

/** 8-char code shown as XXXX-XXXX (~39 bits — brute force is rate-limited). */
export function generateUserCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalize user input before hashing/compare: uppercase, strip separators. */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// --- Wire shapes -----------------------------------------------------------

/** RFC 6749 §5.2 / RFC 8628 §3.5 error codes the token surface can emit. */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_target'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_client_metadata'
  | 'invalid_redirect_uri'
  | 'access_denied'
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token';

/** Raw OAuth error body — clients branch on `error`, so these responses must
 *  bypass the app-wide `{error, code}` shape (ERROR_HANDLING.md exception). */
export function oauthErrorBody(
  error: OAuthErrorCode,
  description?: string,
): { error: OAuthErrorCode; error_description?: string } {
  return description ? { error, error_description: description } : { error };
}

/** The `/mcp` 401 challenge pointing clients at protected-resource metadata. */
export function wwwAuthenticate(baseUrl: string, opts?: { invalidToken?: boolean }): string {
  const parts = [
    `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`,
  ];
  if (opts?.invalidToken) parts.push('error="invalid_token"');
  return parts.join(', ');
}

/** Append OAuth params to a redirect target, preserving its existing query. */
export function appendRedirectParams(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
