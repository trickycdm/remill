import { describe, it, expect } from 'vitest';
import {
  signFrameTicket,
  verifyFrameTicket,
  FRAME_TICKET_TTL_SECONDS,
  type FrameTicketClaims,
} from './ticket';

const SECRET = 's'.repeat(32);
const NOW = '2026-10-04T12:00:00Z';
const later = (seconds: number) => new Date(new Date(NOW).getTime() + seconds * 1000).toISOString();

const CLAIMS: FrameTicketClaims = {
  documentId: 'doc_PaH4boUom6UNZ-CkK2_EVu3',
  revision: 0,
  viewer: { kind: 'principal', id: 'prn_1fyJGrUVczdWJ8n0IWA8r' },
};

describe('frame tickets (D60)', () => {
  it('round-trips every viewer kind', async () => {
    const viewers: FrameTicketClaims['viewer'][] = [
      { kind: 'anonymous' },
      { kind: 'principal', id: 'prn_a-b_c' },
      { kind: 'link', id: 'ab12cd34' },
    ];
    for (const viewer of viewers) {
      const claims = { documentId: 'doc_x', revision: 7, viewer };
      const ticket = await signFrameTicket(SECRET, claims, NOW);
      expect(await verifyFrameTicket(SECRET, ticket, NOW)).toEqual(claims);
    }
  });

  it('is URL-path safe', async () => {
    expect(await signFrameTicket(SECRET, CLAIMS, NOW)).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('expires after the TTL — enforced by the signature, not the caller', async () => {
    const ticket = await signFrameTicket(SECRET, CLAIMS, NOW);
    expect(await verifyFrameTicket(SECRET, ticket, later(FRAME_TICKET_TTL_SECONDS))).toEqual(
      CLAIMS,
    );
    expect(await verifyFrameTicket(SECRET, ticket, later(FRAME_TICKET_TTL_SECONDS + 1))).toBeNull();
    // Pushing the embedded expiry forward breaks the signature.
    const parts = ticket.split('.');
    parts[4] = String(Number(parts[4]) + 3600);
    expect(await verifyFrameTicket(SECRET, parts.join('.'), NOW)).toBeNull();
  });

  it('rejects a ticket replayed for another document, revision or viewer', async () => {
    const ticket = await signFrameTicket(SECRET, CLAIMS, NOW);
    const swap = (index: number, value: string) => {
      const parts = ticket.split('.');
      parts[index] = value;
      return parts.join('.');
    };
    expect(await verifyFrameTicket(SECRET, swap(1, 'doc_other'), NOW)).toBeNull();
    expect(await verifyFrameTicket(SECRET, swap(2, '3'), NOW)).toBeNull();
    expect(await verifyFrameTicket(SECRET, swap(3, 'pprn_admin'), NOW)).toBeNull();
    expect(await verifyFrameTicket(SECRET, swap(3, 'a'), NOW)).toBeNull();
  });

  it('rejects a ticket signed with another secret, and malformed input', async () => {
    const ticket = await signFrameTicket('t'.repeat(32), CLAIMS, NOW);
    expect(await verifyFrameTicket(SECRET, ticket, NOW)).toBeNull();
    for (const bad of [
      '',
      'v1',
      'v1.doc_x.0.a.1',
      'v2.doc_x.0.a.9999999999.00',
      'v1.doc x.0.a.9999999999.00',
      'v1.doc_x.0.z9.9999999999.00',
    ]) {
      expect(await verifyFrameTicket(SECRET, bad, NOW), bad).toBeNull();
    }
  });

  it('refuses to sign claims that could not be parsed back', async () => {
    await expect(
      signFrameTicket(SECRET, { ...CLAIMS, documentId: 'doc.with.dots' }, NOW),
    ).rejects.toThrow();
    await expect(signFrameTicket(SECRET, { ...CLAIMS, revision: -1 }, NOW)).rejects.toThrow();
  });
});
