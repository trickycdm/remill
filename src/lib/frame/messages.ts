/**
 * The frame ⇄ shell message protocol (D60) — how the review island in the
 * viewer shell talks to the comment bridge inside the sandboxed document.
 *
 * TRUST: the bridge shares its window with the author's own scripts, so
 * anything arriving from the frame is UNTRUSTED input. `parseFrameMessage`
 * accepts only the exact shapes below, with every string and number bounded.
 * A frame message can at most PROPOSE an anchor (which the reader must still
 * submit, and the server re-validates against the stored text) or ask the
 * shell to focus a thread card. It can never post, navigate, or carry markup.
 *
 * Pure and DOM-free: imported by the shell island, the bridge, and tests.
 */

import { CONTEXT_CHARS } from '@/lib/anchor/text';

export const FRAME_MESSAGE = 'rm-frame';
export const SHELL_MESSAGE = 'rm-shell';

/** Upper bound on a proposed quote. Deliberately above `MAX_QUOTE_CHARS` so an
 *  over-long selection still reaches the server and gets its honest error. */
const MAX_PROPOSED_QUOTE = 4000;
const MAX_ID = 200;
const MAX_BLOCK_ID = 2000;

/** A viewport rectangle, in the SENDER's coordinates. */
export interface FrameRect {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** The text a reader selected inside the frame, as a canonical-text anchor
 *  (the field is the shell's to supply — the frame never names it). */
export interface FrameSelection {
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly start: number;
  readonly blockId?: string;
  readonly rect: FrameRect;
}

export type FrameMessage =
  /** The bridge is listening — send it the threads to paint. */
  | { readonly rm: typeof FRAME_MESSAGE; readonly type: 'ready' }
  | {
      readonly rm: typeof FRAME_MESSAGE;
      readonly type: 'selection';
      readonly selection: FrameSelection | null;
    }
  /** The reader clicked a highlighted passage or commented block. */
  | { readonly rm: typeof FRAME_MESSAGE; readonly type: 'focus'; readonly id: string };

/** One open thread's anchor — everything the bridge needs to paint it. */
export type PaintThread =
  | {
      readonly id: string;
      readonly kind: 'text';
      readonly quote: string;
      readonly prefix: string;
      readonly suffix: string;
      readonly start: number;
    }
  | { readonly id: string; readonly kind: 'block'; readonly block: string };

export type ShellMessage =
  | {
      readonly rm: typeof SHELL_MESSAGE;
      readonly type: 'paint';
      readonly threads: readonly PaintThread[];
    }
  | { readonly rm: typeof SHELL_MESSAGE; readonly type: 'activate'; readonly id: string | null }
  /** Scroll a thread's passage into view. */
  | { readonly rm: typeof SHELL_MESSAGE; readonly type: 'reveal'; readonly id: string }
  | { readonly rm: typeof SHELL_MESSAGE; readonly type: 'clear-selection' };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isCoord = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;

function parseRect(v: unknown): FrameRect | null {
  if (!isRecord(v)) return null;
  const { top, left, bottom, right } = v;
  return isCoord(top) && isCoord(left) && isCoord(bottom) && isCoord(right)
    ? { top, left, bottom, right }
    : null;
}

function parseSelection(v: unknown): FrameSelection | null {
  if (!isRecord(v)) return null;
  const { quote, prefix, suffix, start, blockId } = v;
  const rect = parseRect(v.rect);
  if (!rect) return null;
  if (!isText(quote, MAX_PROPOSED_QUOTE) || quote.length === 0) return null;
  if (!isText(prefix, CONTEXT_CHARS) || !isText(suffix, CONTEXT_CHARS)) return null;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0) return null;
  if (blockId !== undefined && (!isText(blockId, MAX_BLOCK_ID) || blockId.length === 0))
    return null;
  return { quote, prefix, suffix, start, ...(blockId !== undefined ? { blockId } : {}), rect };
}

/** Validate a message that claims to come from the frame bridge. Returns a
 *  freshly built object (never the sender's), or null for anything else. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (!isRecord(data) || data.rm !== FRAME_MESSAGE) return null;
  switch (data.type) {
    case 'ready':
      return { rm: FRAME_MESSAGE, type: 'ready' };
    case 'selection': {
      if (data.selection === null) return { rm: FRAME_MESSAGE, type: 'selection', selection: null };
      const selection = parseSelection(data.selection);
      return selection ? { rm: FRAME_MESSAGE, type: 'selection', selection } : null;
    }
    case 'focus':
      return isText(data.id, MAX_ID) && data.id.length > 0
        ? { rm: FRAME_MESSAGE, type: 'focus', id: data.id }
        : null;
    default:
      return null;
  }
}
