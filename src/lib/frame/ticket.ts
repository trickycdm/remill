/**
 * Frame tickets (D60) — how the viewer shell tells the frame content route WHO
 * is looking at WHICH document. The framed document runs in an opaque origin
 * and carries no cookies, so identity cannot ride the session; it rides a
 * short-lived, HMAC-signed ticket in the iframe URL instead.
 *
 * A ticket carries IDENTITY, never access: the content route rebuilds the
 * principal it names and runs the ordinary `authorize()` read, so a revoked
 * link or a lost role fails on the next load and every frame read is audited.
 * Forging a ticket needs `SESSION_SECRET`; stealing one buys at most
 * `FRAME_TICKET_TTL_SECONDS` of the access its viewer already has.
 *
 * Shape: `v1.<docId>.<revision>.<viewer>.<expSeconds>.<sig>` — `sig` is
 * HMAC-SHA256 over the `v1:frame:`-prefixed payload (the prefix keeps this
 * message space disjoint from every other use of the secret, as in
 * `share-unlock.ts`). `revision` 0 means "the current one".
 */

import { timingSafeEqualHex } from '@/lib/password';

export const FRAME_TICKET_TTL_SECONDS = 300;

/** Who is looking. `link` carries the share-link grant's subject id (the token
 *  HASH — the same value `Principal.linkId` holds), never the token. */
export type FrameViewer =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'principal'; readonly id: string }
  | { readonly kind: 'link'; readonly id: string };

export interface FrameTicketClaims {
  readonly documentId: string;
  /** 0 = the current revision. */
  readonly revision: number;
  readonly viewer: FrameViewer;
}

// Ids are nanoid/hex — never a dot, so `.` is a safe separator.
const ID = /^[A-Za-z0-9_-]+$/;

function encodeViewer(viewer: FrameViewer): string {
  if (viewer.kind === 'anonymous') return 'a';
  return `${viewer.kind === 'principal' ? 'p' : 'l'}${viewer.id}`;
}

function decodeViewer(raw: string): FrameViewer | null {
  if (raw === 'a') return { kind: 'anonymous' };
  const id = raw.slice(1);
  if (!ID.test(id)) return null;
  if (raw[0] === 'p') return { kind: 'principal', id };
  if (raw[0] === 'l') return { kind: 'link', id };
  return null;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v1:frame:${payload}`),
  );
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mint a ticket valid for `FRAME_TICKET_TTL_SECONDS` from `now` (ISO-8601). */
export async function signFrameTicket(
  secret: string,
  claims: FrameTicketClaims,
  now: string,
): Promise<string> {
  if (!ID.test(claims.documentId) || !Number.isInteger(claims.revision) || claims.revision < 0) {
    throw new Error('Invalid frame ticket claims');
  }
  const exp = Math.floor(new Date(now).getTime() / 1000) + FRAME_TICKET_TTL_SECONDS;
  const payload = `${claims.documentId}.${claims.revision}.${encodeViewer(claims.viewer)}.${exp}`;
  return `v1.${payload}.${await sign(secret, payload)}`;
}

/** Verify a presented ticket. Malformed, tampered and expired tickets are all
 *  the same `null` — the caller renders one indistinguishable 404. */
export async function verifyFrameTicket(
  secret: string,
  presented: string,
  now: string,
): Promise<FrameTicketClaims | null> {
  const parts = presented.split('.');
  if (parts.length !== 6 || parts[0] !== 'v1') return null;
  const [, documentId, rev, rawViewer, exp, sig] = parts;
  if (!ID.test(documentId) || !/^\d+$/.test(rev) || !/^\d+$/.test(exp)) return null;
  const viewer = decodeViewer(rawViewer);
  if (!viewer) return null;
  const expected = await sign(secret, `${documentId}.${rev}.${rawViewer}.${exp}`);
  if (!timingSafeEqualHex(expected, sig)) return null;
  if (Math.floor(new Date(now).getTime() / 1000) > Number(exp)) return null;
  return { documentId, revision: Number(rev), viewer };
}
