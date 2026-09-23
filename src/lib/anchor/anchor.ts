/**
 * Comment anchors (D55) — where on a document a comment thread points, and how
 * that pointer is re-found after the document changes.
 *
 *   text      a quote in one field, with context either side and the offset it
 *             was last seen at. Re-found by quote, disambiguated by context and
 *             proximity to the old offset.
 *   block     a whole element (chart, widget, image) by its block id.
 *   document  the document as a whole. Also where a text/block anchor lands when
 *             its target can't be found at creation — e.g. a quote from text a
 *             script generated in the browser, which the server never sees. The
 *             reviewer's selection is kept as `quote` so a reader still knows
 *             what was meant.
 */

import { InputValidationError } from '@/lib/errors';
import type { CanonicalField } from './canonical';
import { CONTEXT_CHARS, MAX_QUOTE_CHARS, foldWhitespace } from './text';

export interface TextAnchor {
  readonly kind: 'text';
  readonly field: string;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly start: number;
}

export interface BlockAnchor {
  readonly kind: 'block';
  readonly field: string;
  readonly blockId: string;
}

export interface DocumentAnchor {
  readonly kind: 'document';
  readonly field?: string;
  readonly quote?: string;
}

export type Anchor = TextAnchor | BlockAnchor | DocumentAnchor;

/** What a caller (the review island, an agent over MCP) proposes. Everything
 *  but the kind is optional: an agent may send only a quote, and the server
 *  finds the field and the offset. `blockId` on a text proposal names the
 *  enclosing block to fall back to if the quote can't be found. */
export interface AnchorInput {
  readonly kind: 'text' | 'block' | 'document';
  readonly field?: string;
  readonly quote?: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly start?: number;
  readonly blockId?: string;
}

export type AnchorStatus = 'anchored' | 'outdated';

/** Every offset at which `needle` occurs in `hay`. */
function occurrences(hay: string, needle: string): number[] {
  const hits: number[] = [];
  if (!needle) return hits;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) hits.push(i);
  return hits;
}

/** Length of the common suffix of `a` and `b` (how much of a stored prefix still
 *  precedes a candidate). */
function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Re-find a quote in a field's canonical text. Among all occurrences, prefer the
 * one whose surrounding text best matches the stored context, then the one
 * nearest the old offset. Returns the new start, or null when the quote is gone.
 */
export function locateQuote(
  text: string,
  quote: string,
  context: { prefix?: string; suffix?: string; start?: number },
): number | null {
  const hits = occurrences(text, quote);
  if (hits.length === 0) return null;
  const prefix = context.prefix ?? '';
  const suffix = context.suffix ?? '';
  const near = context.start ?? 0;
  let best = hits[0];
  let bestScore = -Infinity;
  for (const i of hits) {
    const before = text.slice(Math.max(0, i - prefix.length), i);
    const after = text.slice(i + quote.length, i + quote.length + suffix.length);
    const contextScore = commonSuffix(before, prefix) + commonPrefix(after, suffix);
    // Context dominates; distance only breaks ties (scaled well below 1 char).
    const score = contextScore - Math.abs(i - near) / (text.length + 1);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function contextAround(text: string, start: number, length: number) {
  return {
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(start + length, start + length + CONTEXT_CHARS),
  };
}

/** The proposed anchor itself is malformed (as opposed to the document having
 *  changed, which downgrades rather than fails). */
function badAnchor(message: string): InputValidationError {
  return new InputValidationError([{ path: 'anchor', message }]);
}

/**
 * Turn a proposal into a stored anchor against the document's CURRENT canonical
 * text. Text → a located text anchor (context refreshed from the real text);
 * not found → the enclosing block if it exists, else a document anchor keeping
 * the quote. Block → kept if the block exists, else a document anchor.
 */
export function resolveAnchor(
  input: AnchorInput,
  fields: ReadonlyMap<string, CanonicalField>,
): Anchor {
  if (input.kind === 'document') {
    const quote = input.quote ? foldWhitespace(input.quote).slice(0, MAX_QUOTE_CHARS) : undefined;
    return { kind: 'document', ...(input.field ? { field: input.field } : {}), ...(quote ? { quote } : {}) };
  }
  if (input.field !== undefined && !fields.has(input.field)) {
    throw badAnchor(`'${input.field}' is not an annotatable field with content.`);
  }
  const candidates = input.field ? [input.field] : [...fields.keys()];

  if (input.kind === 'block') {
    if (!input.blockId) throw badAnchor('A block anchor needs a blockId.');
    for (const key of candidates) {
      if (fields.get(key)!.blocks.some((b) => b.id === input.blockId)) {
        return { kind: 'block', field: key, blockId: input.blockId };
      }
    }
    return { kind: 'document', ...(input.field ? { field: input.field } : {}) };
  }

  const quote = foldWhitespace(input.quote ?? '');
  if (!quote) throw badAnchor('A text anchor needs a non-empty quote.');
  if (quote.length > MAX_QUOTE_CHARS) {
    throw badAnchor(`A quote may be at most ${MAX_QUOTE_CHARS} characters.`);
  }
  for (const key of candidates) {
    const { text } = fields.get(key)!;
    const at = locateQuote(text, quote, {
      prefix: input.prefix ? foldWhitespace(input.prefix) : undefined,
      suffix: input.suffix ? foldWhitespace(input.suffix) : undefined,
      start: input.start,
    });
    if (at !== null) {
      return { kind: 'text', field: key, quote, start: at, ...contextAround(text, at, quote.length) };
    }
  }
  if (input.blockId) {
    for (const key of candidates) {
      if (fields.get(key)!.blocks.some((b) => b.id === input.blockId)) {
        return { kind: 'block', field: key, blockId: input.blockId };
      }
    }
  }
  return { kind: 'document', ...(input.field ? { field: input.field } : {}), quote };
}

/**
 * Re-locate a stored anchor after the document changed. A text anchor whose
 * quote is still present moves to its new offset (context refreshed); one whose
 * quote is gone keeps its last position and turns 'outdated'. Block anchors are
 * anchored iff the block still exists. Document anchors are always anchored.
 */
export function relocateAnchor(
  anchor: Anchor,
  fields: ReadonlyMap<string, CanonicalField>,
): { anchor: Anchor; status: AnchorStatus } {
  if (anchor.kind === 'document') return { anchor, status: 'anchored' };
  const field = fields.get(anchor.field);
  if (anchor.kind === 'block') {
    const exists = !!field?.blocks.some((b) => b.id === anchor.blockId);
    return { anchor, status: exists ? 'anchored' : 'outdated' };
  }
  const at = field ? locateQuote(field.text, anchor.quote, anchor) : null;
  if (at === null || !field) return { anchor, status: 'outdated' };
  return {
    anchor: { ...anchor, start: at, ...contextAround(field.text, at, anchor.quote.length) },
    status: 'anchored',
  };
}

/** Parse a stored anchor_json value (trusted: only ever written by this module). */
export function parseStoredAnchor(json: string | null): Anchor | null {
  if (!json) return null;
  return JSON.parse(json) as Anchor;
}
