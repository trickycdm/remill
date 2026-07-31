import { describe, it, expect } from 'vitest';
import { resolveBaseUrl } from '@/lib/base-url';

describe('resolveBaseUrl — env > settings.siteUrl > request origin', () => {
  it('prefers env.BASE_URL over everything', () => {
    expect(
      resolveBaseUrl({ BASE_URL: 'https://remill.example' }, { siteUrl: 'https://other.example' }, 'http://127.0.0.1:3100/x'),
    ).toBe('https://remill.example');
  });

  it('falls back to settings.siteUrl when env is unset/blank', () => {
    expect(resolveBaseUrl({ BASE_URL: '' }, { siteUrl: 'https://site.example' }, 'http://127.0.0.1:3100/x')).toBe(
      'https://site.example',
    );
    expect(resolveBaseUrl(undefined, { siteUrl: 'https://site.example' })).toBe('https://site.example');
  });

  it('falls back to the request origin last', () => {
    expect(resolveBaseUrl(undefined, {}, 'http://127.0.0.1:3100/admin/x?y=1')).toBe('http://127.0.0.1:3100');
  });

  it('strips trailing slashes from configured values', () => {
    expect(resolveBaseUrl({ BASE_URL: 'https://remill.example/' }, undefined)).toBe('https://remill.example');
    expect(resolveBaseUrl(undefined, { siteUrl: 'https://site.example//' })).toBe('https://site.example');
  });

  it('returns empty string when nothing is available or the request URL is garbage', () => {
    expect(resolveBaseUrl(undefined, undefined)).toBe('');
    expect(resolveBaseUrl(undefined, {}, 'not a url')).toBe('');
  });
});
