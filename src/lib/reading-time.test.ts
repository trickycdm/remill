import { describe, it, expect } from 'vitest';
import { readingTimeMinutes } from '@/lib/reading-time';

describe('readingTimeMinutes', () => {
  it('empty or whitespace text is 0 minutes', () => {
    expect(readingTimeMinutes('')).toBe(0);
    expect(readingTimeMinutes('   \n  \t ')).toBe(0);
  });

  it('a short body rounds up to at least 1 minute', () => {
    expect(readingTimeMinutes('one two three')).toBe(1);
  });

  it('scales with word count at the default 220 wpm', () => {
    const text = Array.from({ length: 660 }, (_, i) => `w${i}`).join(' ');
    expect(readingTimeMinutes(text)).toBe(3); // 660 / 220
  });

  it('honors a custom wpm', () => {
    const text = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    expect(readingTimeMinutes(text, 100)).toBe(2);
  });

  it('collapses irregular whitespace when counting', () => {
    expect(readingTimeMinutes('  alpha   beta \n\n gamma  ')).toBe(1);
  });
});
