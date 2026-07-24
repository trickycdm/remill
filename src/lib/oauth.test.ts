import { describe, it, expect } from 'vitest';
import {
  pkceChallengeFromVerifier,
  verifyPkceS256,
  isValidRedirectUri,
  validateRedirectUris,
  redirectUriMatches,
  generateUserCode,
  normalizeUserCode,
  oauthErrorBody,
  wwwAuthenticate,
  appendRedirectParams,
} from '@/lib/oauth';

// RFC 7636 appendix B reference vector.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('PKCE S256 (RFC 7636)', () => {
  it('reproduces the appendix B vector', async () => {
    expect(await pkceChallengeFromVerifier(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    expect(await verifyPkceS256(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it('rejects a wrong verifier', async () => {
    expect(await verifyPkceS256('a'.repeat(43), RFC_CHALLENGE)).toBe(false);
  });

  it('fails closed on malformed verifiers (length + charset)', async () => {
    for (const bad of ['short', 'a'.repeat(42), 'a'.repeat(129), '!'.repeat(43)]) {
      expect(await verifyPkceS256(bad, RFC_CHALLENGE), `should reject '${bad.slice(0, 8)}…'`).toBe(
        false,
      );
    }
  });
});

describe('redirect-URI validation (registration time)', () => {
  it('allows https, loopback http, and private-use schemes', () => {
    for (const ok of [
      'https://claude.ai/api/mcp/auth_callback',
      'http://127.0.0.1/callback',
      'http://127.0.0.1:39415/callback',
      'http://[::1]:8080/cb',
      'http://localhost:3000/cb',
      'vscode://ms-vscode.copilot-mcp/callback',
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'com.example.app:/oauth',
    ]) {
      expect(isValidRedirectUri(ok), ok).toBe(true);
    }
  });

  it('rejects non-loopback http, fragments, forbidden schemes, and junk', () => {
    for (const bad of [
      'http://example.com/cb', // http off loopback
      'https://example.com/cb#frag', // fragment
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'not a url',
      '',
    ]) {
      expect(isValidRedirectUri(bad), bad).toBe(false);
    }
  });

  it('validateRedirectUris: whole-array semantics, empty and mixed rejected', () => {
    expect(validateRedirectUris(['https://a.example/cb'])).toEqual(['https://a.example/cb']);
    expect(validateRedirectUris([])).toBeNull();
    expect(validateRedirectUris(['https://a.example/cb', 'http://evil.example/cb'])).toBeNull();
    expect(validateRedirectUris('https://a.example/cb')).toBeNull();
    expect(validateRedirectUris([42])).toBeNull();
  });
});

describe('redirect-URI matching (authorize/token time)', () => {
  it('exact match for https and custom schemes', () => {
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example/cb')).toBe(true);
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example/cb2')).toBe(false);
    expect(redirectUriMatches('vscode://x/cb', 'vscode://x/cb')).toBe(true);
  });

  it('loopback http matches across ports only (RFC 8252 §7.3)', () => {
    expect(redirectUriMatches('http://127.0.0.1/cb', 'http://127.0.0.1:39415/cb')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1:1000/cb', 'http://127.0.0.1:2000/cb')).toBe(true);
    expect(redirectUriMatches('http://localhost:1000/cb', 'http://localhost:2000/cb')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1/cb', 'http://127.0.0.1/other')).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1/cb', 'http://localhost/cb')).toBe(false);
    // Port-flex never applies off loopback.
    expect(redirectUriMatches('http://example.com:80/cb', 'http://example.com:81/cb')).toBe(false);
  });
});

describe('device user codes', () => {
  it('generates XXXX-XXXX from the unambiguous alphabet', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ2-9]{4}-[BCDFGHJKLMNPQRSTVWXZ2-9]{4}$/);
    }
  });

  it('normalizes user input (case, separators, whitespace)', () => {
    expect(normalizeUserCode('bcdf-ghjk')).toBe('BCDFGHJK');
    expect(normalizeUserCode(' BCDF GHJK ')).toBe('BCDFGHJK');
    expect(normalizeUserCode(normalizeUserCode(generateUserCode()))).toHaveLength(8);
  });
});

describe('wire shapes', () => {
  it('oauthErrorBody omits description when absent', () => {
    expect(oauthErrorBody('invalid_grant')).toEqual({ error: 'invalid_grant' });
    expect(oauthErrorBody('slow_down', 'poll slower')).toEqual({
      error: 'slow_down',
      error_description: 'poll slower',
    });
  });

  it('wwwAuthenticate points at the path-suffixed PRM document', () => {
    expect(wwwAuthenticate('https://remill.org')).toBe(
      'Bearer resource_metadata="https://remill.org/.well-known/oauth-protected-resource/mcp"',
    );
    expect(wwwAuthenticate('https://remill.org', { invalidToken: true })).toContain(
      'error="invalid_token"',
    );
  });

  it('appendRedirectParams preserves existing query params', () => {
    expect(appendRedirectParams('http://127.0.0.1:9/cb?keep=1', { code: 'rmc_x', state: 's' })).toBe(
      'http://127.0.0.1:9/cb?keep=1&code=rmc_x&state=s',
    );
  });
});
