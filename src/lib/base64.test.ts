import { describe, it, expect } from 'vitest';
import { decodeBase64 } from '@/lib/base64';
import { InputValidationError } from '@/lib/errors';

describe('decodeBase64 — strict validation before decode (D34)', () => {
  it('decodes valid base64 (whitespace tolerated)', () => {
    expect(Array.from(decodeBase64('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
    expect(Array.from(decodeBase64('aGVs\nbG8='))).toEqual([104, 101, 108, 108, 111]);
  });

  it('rejects empty, bad charset, and bad padding loudly', () => {
    for (const bad of ['', '!!!!', 'aGVsbG8', 'aGVs=bG8=', 'a===']) {
      expect(() => decodeBase64(bad), `should reject '${bad}'`).toThrow(InputValidationError);
    }
  });
});
