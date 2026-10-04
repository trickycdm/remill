import { describe, it, expect } from 'vitest';
import { parseFrameMessage, FRAME_MESSAGE, SHELL_MESSAGE } from './messages';

const rect = { top: 10, left: 20, bottom: 30, right: 200 };
const selection = {
  quote: 'the quoted text',
  prefix: 'before ',
  suffix: ' after',
  start: 42,
  rect,
};
const msg = (extra: Record<string, unknown>) => ({ rm: FRAME_MESSAGE, ...extra });

describe('parseFrameMessage (D60) — everything from the frame is untrusted', () => {
  it('accepts the three message shapes and rebuilds them', () => {
    expect(parseFrameMessage(msg({ type: 'ready', extra: 'dropped' }))).toEqual({
      rm: FRAME_MESSAGE,
      type: 'ready',
    });
    expect(parseFrameMessage(msg({ type: 'focus', id: 'cmt_1' }))).toEqual({
      rm: FRAME_MESSAGE,
      type: 'focus',
      id: 'cmt_1',
    });
    expect(parseFrameMessage(msg({ type: 'selection', selection: null }))).toEqual({
      rm: FRAME_MESSAGE,
      type: 'selection',
      selection: null,
    });
    const sent = {
      ...selection,
      blockId: 'chart-1',
      html: '<img onerror=x>',
      rect: { ...rect, evil: 1 },
    };
    const parsed = parseFrameMessage(msg({ type: 'selection', selection: sent }));
    // A fresh object carrying ONLY the known fields.
    expect(parsed).toEqual({
      rm: FRAME_MESSAGE,
      type: 'selection',
      selection: { ...selection, blockId: 'chart-1' },
    });
  });

  it('rejects anything that is not a frame message', () => {
    for (const bad of [
      null,
      undefined,
      'ready',
      7,
      [],
      {},
      { type: 'ready' },
      { rm: SHELL_MESSAGE, type: 'ready' },
      msg({ type: 'post' }),
      msg({}),
    ]) {
      expect(parseFrameMessage(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects malformed or oversized selections', () => {
    const bad: Record<string, unknown>[] = [
      { ...selection, quote: '' },
      { ...selection, quote: 'x'.repeat(4001) },
      { ...selection, quote: 12 },
      { ...selection, prefix: 'p'.repeat(33) },
      { ...selection, suffix: null },
      { ...selection, start: -1 },
      { ...selection, start: 1.5 },
      { ...selection, start: '3' },
      { ...selection, blockId: '' },
      { ...selection, blockId: 'b'.repeat(2001) },
      { ...selection, rect: undefined },
      { ...selection, rect: { ...rect, top: Infinity } },
      { ...selection, rect: { ...rect, left: 'x' } },
      { ...selection, rect: { ...rect, right: 1e9 } },
    ];
    for (const s of bad)
      expect(
        parseFrameMessage(msg({ type: 'selection', selection: s })),
        JSON.stringify(s),
      ).toBeNull();
    expect(parseFrameMessage(msg({ type: 'selection' }))).toBeNull();
  });

  it('rejects a focus id that is missing, empty, non-string or oversized', () => {
    for (const id of [undefined, '', 5, 'x'.repeat(201), { toString: () => 'cmt' }]) {
      expect(parseFrameMessage(msg({ type: 'focus', id }))).toBeNull();
    }
  });
});
