import { describe, it, expect } from 'vitest';
import { toFtsQuery, snippetToHtml, snippetToText, SNIPPET_START, SNIPPET_END } from '@/lib/fts';

describe('toFtsQuery — user input → safe MATCH expression (D28)', () => {
  it('quotes each token and prefix-matches the last', () => {
    expect(toFtsQuery('hello world')).toBe('"hello" "world"*');
    expect(toFtsQuery('single')).toBe('"single"*');
  });

  it('neutralizes FTS5 query syntax (operators become quoted phrases)', () => {
    expect(toFtsQuery('a OR b')).toBe('"a" "OR" "b"*');
    expect(toFtsQuery('title:probe')).toBe('"title:probe"*');
    expect(toFtsQuery('NEAR(a b)')).toBe('"NEAR(a" "b)"*');
    expect(toFtsQuery('-negated')).toBe('"-negated"*');
  });

  it('doubles internal double-quotes (FTS5 phrase escaping)', () => {
    expect(toFtsQuery('say "hi"')).toBe('"say" """hi"""*');
  });

  it('collapses whitespace and returns null for empty input', () => {
    expect(toFtsQuery('  a   b  ')).toBe('"a" "b"*');
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
  });
});

describe('snippet rendering — escape-then-mark', () => {
  it('escapes HTML before swapping sentinels for <mark>', () => {
    const raw = `<script> ${SNIPPET_START}match${SNIPPET_END} & more`;
    expect(snippetToHtml(raw)).toBe('&lt;script&gt; <mark>match</mark> &amp; more');
  });

  it('never lets sentinel-adjacent markup through unescaped', () => {
    const raw = `${SNIPPET_START}<img src=x onerror=alert(1)>${SNIPPET_END}`;
    expect(snippetToHtml(raw)).toBe('<mark>&lt;img src=x onerror=alert(1)&gt;</mark>');
  });

  it('snippetToText drops the sentinels for plain-text surfaces', () => {
    expect(snippetToText(`a ${SNIPPET_START}b${SNIPPET_END} c`)).toBe('a b c');
  });
});
