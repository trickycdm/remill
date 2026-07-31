import { describe, it, expect } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = '2026-07-10T12:00:00.000Z';

describe('relativeTime', () => {
  it('renders under a minute as "just now"', () => {
    expect(relativeTime('2026-07-10T11:59:30.000Z', NOW)).toBe('just now');
    expect(relativeTime(NOW, NOW)).toBe('just now');
  });

  it('renders minutes up to an hour', () => {
    expect(relativeTime('2026-07-10T11:59:00.000Z', NOW)).toBe('1m ago');
    expect(relativeTime('2026-07-10T11:05:00.000Z', NOW)).toBe('55m ago');
  });

  it('renders hours up to a day', () => {
    expect(relativeTime('2026-07-10T11:00:00.000Z', NOW)).toBe('1h ago');
    expect(relativeTime('2026-07-09T12:30:00.000Z', NOW)).toBe('23h ago');
  });

  it('renders days up to 30', () => {
    expect(relativeTime('2026-07-09T12:00:00.000Z', NOW)).toBe('1d ago');
    expect(relativeTime('2026-06-11T12:00:00.000Z', NOW)).toBe('29d ago');
  });

  it('falls back to the date portion beyond 30 days', () => {
    expect(relativeTime('2026-05-01T09:00:00.000Z', NOW)).toBe('2026-05-01');
  });

  it('clamps future timestamps (clock skew) to "just now"', () => {
    expect(relativeTime('2026-07-10T12:05:00.000Z', NOW)).toBe('just now');
  });

  it('returns empty string for invalid input', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
    expect(relativeTime('2026-07-10T11:00:00.000Z', 'garbage')).toBe('');
    expect(relativeTime('', NOW)).toBe('');
  });
});
