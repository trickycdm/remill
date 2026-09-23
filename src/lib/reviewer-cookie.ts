/**
 * Reviewer identity on an OPEN review link (D55). After a reviewer names
 * themselves, the `rm_reviewer` cookie (scoped to `/s/<token>`) carries
 * `${reviewerId}.${sig}`, where `sig` is HMAC-SHA256 over
 * `v1:reviewer:${grantId}:${reviewerId}` keyed by `SESSION_SECRET`. Binding the
 * grant id means a reviewer id lifted from one link is no identity on another;
 * the `v1:reviewer:` prefix keeps the message space disjoint from the unlock
 * proof (src/lib/share-unlock.ts) and every other use of the secret.
 *
 * Personal links never use this — the link's one invited reviewer IS the
 * identity. The cookie asserts only "the person at this browser typed this
 * name on this link": review links are a trusted-team tool, not an identity
 * system (D55).
 */

import { timingSafeEqualHex } from '@/lib/password';

export const REVIEWER_COOKIE = 'rm_reviewer';

async function signature(secret: string, grantId: string, reviewerId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v1:reviewer:${grantId}:${reviewerId}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signReviewer(secret: string, grantId: string, reviewerId: string): Promise<string> {
  return `${reviewerId}.${await signature(secret, grantId, reviewerId)}`;
}

/** The reviewer id a presented cookie vouches for on this grant, or undefined. */
export async function verifyReviewer(
  secret: string,
  grantId: string,
  presented: string | undefined,
): Promise<string | undefined> {
  if (!presented) return undefined;
  const dot = presented.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const reviewerId = presented.slice(0, dot);
  const sig = presented.slice(dot + 1);
  return timingSafeEqualHex(await signature(secret, grantId, reviewerId), sig) ? reviewerId : undefined;
}
