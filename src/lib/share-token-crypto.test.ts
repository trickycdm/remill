import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '@/lib/share-token-crypto';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);
const TOKEN = 'rms_abc123XYZ';

describe('share-token-crypto', () => {
  it('round-trips a token through encrypt then decrypt', async () => {
    const enc = await encryptToken(SECRET, TOKEN);
    expect(await decryptToken(SECRET, enc)).toBe(TOKEN);
  });

  it('never stores the plaintext token inside the ciphertext string', async () => {
    const enc = await encryptToken(SECRET, TOKEN);
    expect(enc).not.toContain(TOKEN);
  });

  it('returns null for a tampered ciphertext', async () => {
    const enc = await encryptToken(SECRET, TOKEN);
    const parts = enc.split('.');
    // Flip the last character of the ciphertext segment.
    const last = parts[2].slice(-1);
    const flipped = last === 'A' ? 'B' : 'A';
    parts[2] = `${parts[2].slice(0, -1)}${flipped}`;
    expect(await decryptToken(SECRET, parts.join('.'))).toBeNull();
  });

  it('returns null when decrypted with the wrong secret', async () => {
    const enc = await encryptToken(SECRET, TOKEN);
    expect(await decryptToken(OTHER_SECRET, enc)).toBeNull();
  });

  it('returns null for a malformed value', async () => {
    expect(await decryptToken(SECRET, 'not-a-valid-value')).toBeNull();
    expect(await decryptToken(SECRET, 'v2.abc.def')).toBeNull();
  });

  it('produces distinct ciphertexts (and IVs) for the same token on repeated calls', async () => {
    const enc1 = await encryptToken(SECRET, TOKEN);
    const enc2 = await encryptToken(SECRET, TOKEN);
    expect(enc1).not.toBe(enc2);
    const iv1 = enc1.split('.')[1];
    const iv2 = enc2.split('.')[1];
    expect(iv1).not.toBe(iv2);
  });
});
