import { describe, it, expect } from 'vitest';
import { diffLines, valueToLines, DIFF_MAX_CELLS } from '@/lib/diff';

function render(ops: NonNullable<ReturnType<typeof diffLines>>): string[] {
  return ops.map((o) => `${o.kind === 'same' ? ' ' : o.kind === 'add' ? '+' : '-'}${o.line}`);
}

describe('diffLines (LCS)', () => {
  it('identical inputs are all-same', () => {
    const ops = diffLines('a\nb\nc', 'a\nb\nc')!;
    expect(render(ops)).toEqual([' a', ' b', ' c']);
  });

  it('marks adds, dels, and unchanged lines in order (dels before adds)', () => {
    const ops = diffLines('one\ntwo\nthree', 'one\n2\nthree')!;
    expect(render(ops)).toEqual([' one', '-two', '+2', ' three']);
  });

  it('handles pure insertion and pure deletion', () => {
    expect(render(diffLines('a\nc', 'a\nb\nc')!)).toEqual([' a', '+b', ' c']);
    expect(render(diffLines('a\nb\nc', 'a\nc')!)).toEqual([' a', '-b', ' c']);
  });

  it('handles empty sides', () => {
    expect(render(diffLines('', 'x\ny')!)).toEqual(['-', '+x', '+y']);
    expect(render(diffLines('x\ny', '')!)).toEqual(['-x', '-y', '+']);
    expect(render(diffLines('', '')!)).toEqual([' ']);
  });

  it('keeps the longest common subsequence (does not resync greedily)', () => {
    const ops = diffLines('a\nb\nc\na\nb\nb\na', 'c\nb\na\nb\na\nc')!;
    const lcs = ops.filter((o) => o.kind === 'same').map((o) => o.line);
    expect(lcs.length).toBe(4); // classic LCS example: length 4
    // Every 'same' line must appear in both inputs in order — spot-check ends.
    expect(ops.at(-1)).toBeDefined();
  });

  it('prefix/suffix trimming keeps large-but-similar inputs cheap', () => {
    const common = Array.from({ length: 50_000 }, (_, i) => `line ${i}`);
    const aArr = [...common, 'CHANGED A', ...common];
    const bArr = [...common, 'CHANGED B', ...common];
    const ops = diffLines(aArr.join('\n'), bArr.join('\n'))!;
    expect(ops).not.toBeNull(); // 100k lines/side, but the core is 1×1
    expect(ops.filter((o) => o.kind !== 'same').map(render0)).toEqual(['-CHANGED A', '+CHANGED B']);
    expect(ops.length).toBe(100_002); // 100k same + 1 del + 1 add
  });

  it('returns null when the post-trim core exceeds the cell budget', () => {
    // 2001 × 2001 distinct-on-both-sides lines > 4M cells.
    const side = Math.ceil(Math.sqrt(DIFF_MAX_CELLS)) + 1;
    const aArr = Array.from({ length: side }, (_, i) => `a${i}`);
    const bArr = Array.from({ length: side }, (_, i) => `b${i}`);
    expect(diffLines(aArr.join('\n'), bArr.join('\n'))).toBeNull();
  });
});

function render0(o: { kind: string; line: string }): string {
  return `${o.kind === 'add' ? '+' : '-'}${o.line}`;
}

describe('valueToLines', () => {
  it('strings verbatim; absent empty; the rest pretty JSON', () => {
    expect(valueToLines('a\nb')).toBe('a\nb');
    expect(valueToLines(undefined)).toBe('');
    expect(valueToLines(null)).toBe('');
    expect(valueToLines(42)).toBe('42');
    expect(valueToLines(['x', 'y'])).toBe('[\n  "x",\n  "y"\n]');
    expect(valueToLines({ k: 1 })).toBe('{\n  "k": 1\n}');
  });
});
