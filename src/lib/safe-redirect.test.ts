import { describe, it, expect } from 'vitest';
import { safeRedirect } from '@/lib/safe-redirect';

describe('safeRedirect', () => {
  it('keeps same-origin relative paths', () => {
    expect(safeRedirect('/admin/c/posts?page=2#top')).toBe('/admin/c/posts?page=2#top');
  });

  it('defaults to /admin for a missing or empty target', () => {
    expect(safeRedirect(undefined)).toBe('/admin');
    expect(safeRedirect('')).toBe('/admin');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    'evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/admin\\..\\evil',
  ])('refuses %j', (target) => {
    expect(safeRedirect(target)).toBe('/admin');
  });
});
