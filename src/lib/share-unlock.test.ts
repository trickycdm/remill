import { describe, it, expect } from 'vitest';
import { signUnlock, verifyUnlock } from '@/lib/share-unlock';

const SECRET = 'a'.repeat(32);
const NOW = '2026-09-23T12:00:00Z';
const EXP = '2026-09-24T12:00:00Z'; // 24h horizon

describe('share-unlock', () => {
  it('verifies a proof signed for the same grant + hash, before its expiry', async () => {
    const proof = await signUnlock(SECRET, 'grant_1', 'hash_1', EXP);
    expect(await verifyUnlock(SECRET, 'grant_1', 'hash_1', proof, NOW)).toBe(true);
  });

  it('rejects a tampered proof (deterministic flip — never a no-op edit)', async () => {
    const proof = await signUnlock(SECRET, 'grant_1', 'hash_1', EXP);
    const last = proof.slice(-1);
    const flipped = last === '0' ? '1' : '0';
    expect(await verifyUnlock(SECRET, 'grant_1', 'hash_1', `${proof.slice(0, -1)}${flipped}`, NOW)).toBe(false);
  });

  it('rejects a proof from a different grant', async () => {
    const proof = await signUnlock(SECRET, 'grant_1', 'hash_1', EXP);
    expect(await verifyUnlock(SECRET, 'grant_2', 'hash_1', proof, NOW)).toBe(false);
  });

  it('invalidates the proof when the password hash changes', async () => {
    const proof = await signUnlock(SECRET, 'grant_1', 'hash_1', EXP);
    expect(await verifyUnlock(SECRET, 'grant_1', 'hash_2', proof, NOW)).toBe(false);
  });

  it('rejects an empty presented value', async () => {
    expect(await verifyUnlock(SECRET, 'grant_1', 'hash_1', '', NOW)).toBe(false);
  });

  it('rejects a malformed presented value (no exp.sig separator)', async () => {
    expect(await verifyUnlock(SECRET, 'grant_1', 'hash_1', 'not-a-valid-cookie', NOW)).toBe(false);
  });

  it('rejects a proof signed with a different secret', async () => {
    const proof = await signUnlock(SECRET, 'grant_1', 'hash_1', EXP);
    expect(await verifyUnlock('b'.repeat(32), 'grant_1', 'hash_1', proof, NOW)).toBe(false);
  });

  it('the server enforces expiry itself — rejects once `now` passes the embedded exp, even with a valid signature', async () => {
    const proof = await signUnlock(SECRET, 'grant_1', 'hash_1', EXP);
    expect(await verifyUnlock(SECRET, 'grant_1', 'hash_1', proof, '2026-09-25T12:00:00Z')).toBe(false);
  });

  it('accepts exactly at the expiry boundary', async () => {
    const proof = await signUnlock(SECRET, 'grant_1', 'hash_1', EXP);
    expect(await verifyUnlock(SECRET, 'grant_1', 'hash_1', proof, EXP)).toBe(true);
  });
});
