import { describe, it, expect } from 'vitest';
import { formatDate } from '@/lib/format-date';
import type { SiteSettings } from '@/services/settings';

const TS = '2026-07-05T12:00:00Z';

describe('formatDate', () => {
  it("defaults to ISO (Y-M-D) when no settings are given", () => {
    expect(formatDate(TS)).toBe('2026-07-05');
  });

  it('honours the iso preset', () => {
    expect(formatDate(TS, { dateFormat: 'iso' })).toBe('2026-07-05');
  });

  it('honours the long preset', () => {
    expect(formatDate(TS, { dateFormat: 'long' })).toBe('July 5, 2026');
  });

  it('honours the short preset', () => {
    expect(formatDate(TS, { dateFormat: 'short' })).toBe('Jul 5, 2026');
  });

  it('falls back to iso for an unknown dateFormat value', () => {
    expect(formatDate(TS, { dateFormat: 'nonsense' as SiteSettings['dateFormat'] })).toBe('2026-07-05');
  });

  it('applies the configured timezone (shifting the calendar date)', () => {
    // 02:00 UTC is the previous evening in New York → the local date rolls back.
    const early = '2026-07-05T02:00:00Z';
    expect(formatDate(early, { timezone: 'America/New_York' })).toBe('2026-07-04');
    // UTC (the default) keeps it on the 5th.
    expect(formatDate(early)).toBe('2026-07-05');
  });

  it('formats long-form in the configured timezone', () => {
    expect(formatDate('2026-07-05T02:00:00Z', { dateFormat: 'long', timezone: 'America/New_York' })).toBe(
      'July 4, 2026',
    );
  });

  it('falls back to the raw date slice for an unparseable timestamp', () => {
    expect(formatDate('not-a-date', { dateFormat: 'long' })).toBe('not-a-date');
  });

  it('falls back gracefully for an invalid timezone', () => {
    // A bogus IANA name makes Intl throw a RangeError; the helper degrades to slice.
    expect(formatDate(TS, { timezone: 'Not/AZone' })).toBe('2026-07-05');
  });
});
