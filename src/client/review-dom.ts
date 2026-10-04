/**
 * Canonical-text plumbing over a live DOM (D55) — shared by the review island
 * (annotating fields in its own document) and the frame bridge (annotating the
 * author's document inside the sandboxed frame, D60). Mirrors the server rules
 * in src/lib/anchor/text.ts so a character offset means the same on both sides.
 *
 * Excluded from the server tsconfig — runs in the browser.
 */

import { CONTEXT_CHARS } from '../lib/anchor/text';

export interface TextMap {
  readonly text: string;
  /** For each canonical character: the text node and offset it came from. */
  readonly pos: readonly (readonly [Text, number])[];
}

const WS = /\s/;

/** The canonical text of one region — the server's rules (text.ts): text nodes
 *  in order, `skipped` tags excluded, whitespace runs folded, leading space
 *  dropped, trailing space trimmed. */
export function buildMap(region: Element, skipped: ReadonlySet<string>): TextMap {
  let text = '';
  const pos: [Text, number][] = [];
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentElement; el && el !== region; el = el.parentElement) {
        if (skipped.has(el.localName)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const data = n.data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (WS.test(ch)) {
        if (text.length > 0 && text[text.length - 1] !== ' ') {
          text += ' ';
          pos.push([n, i]);
        }
      } else {
        text += ch;
        pos.push([n, i]);
      }
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    pos.pop();
  }
  return { text, pos };
}

export function rangeFor(map: TextMap, start: number, length: number): Range | null {
  if (length <= 0 || start < 0 || start + length > map.pos.length) return null;
  const [sNode, sOff] = map.pos[start];
  const [eNode, eOff] = map.pos[start + length - 1];
  const r = document.createRange();
  r.setStart(sNode, sOff);
  r.setEnd(eNode, eOff + 1);
  return r;
}

/** Canonical [start, end) of the characters a range covers, or null. */
export function offsetsOf(map: TextMap, range: Range): [number, number] | null {
  let s = -1;
  let e = -1;
  let node: Text | null = null;
  let hit = false;
  for (let k = 0; k < map.pos.length; k++) {
    const [n, i] = map.pos[k];
    if (n !== node) {
      node = n;
      hit = range.intersectsNode(n);
    }
    if (!hit) continue;
    if (range.comparePoint(n, i) === 0 && range.comparePoint(n, i + 1) === 0) {
      if (s < 0) s = k;
      e = k + 1;
    }
  }
  if (s < 0) return null;
  while (s < e && map.text[s] === ' ') s++;
  while (e > s && map.text[e - 1] === ' ') e--;
  return s < e ? [s, e] : null;
}

export function blockIdOf(el: Element | null, region: Element): string | undefined {
  for (let x = el; x && x !== region.parentElement; x = x.parentElement) {
    const explicit = x.getAttribute('data-rm-anchor');
    if (explicit) return explicit;
    if (x.localName === 'img' && x.getAttribute('src')) return `img:${x.getAttribute('src')}`;
  }
  return undefined;
}

export function blockElement(region: Element, blockId: string): Element | null {
  if (blockId.startsWith('img:')) {
    const src = blockId.slice(4);
    return (
      [...region.querySelectorAll('img')].find((img) => img.getAttribute('src') === src) ?? null
    );
  }
  return region.querySelector(`[data-rm-anchor="${CSS.escape(blockId)}"]`);
}

/** The element a range starts in. */
export function startElementOf(range: Range): Element | null {
  return range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
}

/** A selection inside `region` as the pieces of a text anchor, or null when
 *  the range covers no canonical text. */
export function quoteOf(
  region: Element,
  range: Range,
  skipped: ReadonlySet<string>,
): {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  blockId: string | undefined;
} | null {
  const map = buildMap(region, skipped);
  const at = offsetsOf(map, range);
  if (!at) return null;
  const [s, e] = at;
  return {
    quote: map.text.slice(s, e),
    prefix: map.text.slice(Math.max(0, s - CONTEXT_CHARS), s),
    suffix: map.text.slice(e, e + CONTEXT_CHARS),
    start: s,
    blockId: blockIdOf(startElementOf(range), region),
  };
}

export function rangeHasPoint(range: Range, x: number, y: number): boolean {
  return [...range.getClientRects()].some(
    (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
  );
}
