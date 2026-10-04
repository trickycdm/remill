import { describe, it, expect } from 'vitest';
import { resolveRelyingParty } from '@/lib/relying-party';

describe('resolveRelyingParty', () => {
  it('uses BASE_URL over the request origin', () => {
    expect(resolveRelyingParty({ BASE_URL: 'https://remill.me/' }, 'https://evil.example/admin/login')).toEqual({
      rpId: 'remill.me',
      origin: 'https://remill.me',
    });
  });

  it('falls back to the request origin when BASE_URL is unset or blank (preview Workers)', () => {
    const expected = { rpId: 'pr-12.example.workers.dev', origin: 'https://pr-12.example.workers.dev' };
    expect(resolveRelyingParty({}, 'https://pr-12.example.workers.dev/admin/login')).toEqual(expected);
    expect(resolveRelyingParty({ BASE_URL: '  ' }, 'https://pr-12.example.workers.dev/x')).toEqual(expected);
    expect(resolveRelyingParty(undefined, 'https://pr-12.example.workers.dev/x')).toEqual(expected);
  });

  it('honours a localhost request when BASE_URL is a loopback address (IPs are not valid RP IDs)', () => {
    expect(resolveRelyingParty({ BASE_URL: 'http://127.0.0.1:3100' }, 'http://localhost:3100/admin/login')).toEqual({
      rpId: 'localhost',
      origin: 'http://localhost:3100',
    });
  });

  it('never lets a non-loopback request override a loopback BASE_URL, or vice versa', () => {
    expect(resolveRelyingParty({ BASE_URL: 'http://127.0.0.1:3100' }, 'https://evil.example/x').rpId).toBe('127.0.0.1');
    expect(resolveRelyingParty({ BASE_URL: 'https://remill.me' }, 'http://localhost:3100/x').rpId).toBe('remill.me');
  });
});
