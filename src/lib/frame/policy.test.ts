import { describe, it, expect } from 'vitest';
import { frameCsp, frameResponseHeaders, FRAME_SANDBOX, FRAME_SANDBOX_TOKENS } from './policy';

const ORIGIN = 'https://remill.test';
const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1) ?? '';

describe('frame policy (D60)', () => {
  const csp = frameCsp(ORIGIN);

  it('sandboxes into an opaque origin and never lets the page navigate the shell', () => {
    expect(directive(csp, 'sandbox')).toBe(FRAME_SANDBOX);
    expect(FRAME_SANDBOX_TOKENS).toContain('allow-scripts');
    expect(FRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(FRAME_SANDBOX).not.toContain('allow-top-navigation');
  });

  it('is frameable only by its own origin', () => {
    expect(directive(csp, 'frame-ancestors')).toBe("'self'");
    expect(frameResponseHeaders(ORIGIN)).not.toHaveProperty('X-Frame-Options');
  });

  it('blocks network calls, nested frames, workers, base and form targets', () => {
    for (const name of [
      'default-src',
      'connect-src',
      'frame-src',
      'worker-src',
      'object-src',
      'base-uri',
      'form-action',
    ]) {
      expect(directive(csp, name), name).toBe("'none'");
    }
  });

  it('allows the library CDNs, Google Fonts, https images and remill-vendored assets — by exact host', () => {
    const scripts = directive(csp, 'script-src');
    for (const host of [
      'https://cdnjs.cloudflare.com',
      'https://cdn.jsdelivr.net',
      'https://unpkg.com',
    ]) {
      expect(scripts).toContain(host);
    }
    // Own-origin scripts are path-scoped to /vendor/ — `'self'` would not match
    // an opaque origin, and the bare origin would admit any same-host script.
    expect(scripts).toContain(`${ORIGIN}/vendor/`);
    expect(scripts.split(' ')).not.toContain(ORIGIN);
    expect(scripts).not.toContain("'self'");
    expect(directive(csp, 'style-src')).toContain('https://fonts.googleapis.com');
    expect(directive(csp, 'font-src')).toContain('https://fonts.gstatic.com');
    expect(directive(csp, 'img-src')).toContain('https:');
    expect(csp).not.toContain('*');
  });

  it('is never cacheable, indexable, or a referrer source', () => {
    const headers = frameResponseHeaders(ORIGIN);
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(headers['X-Robots-Tag']).toBe('noindex');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });
});
