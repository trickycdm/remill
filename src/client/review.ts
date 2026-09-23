/**
 * Review island (D55) — the browser half of the review overlay. The panel
 * (src/components/review/review-panel.tsx) is server-rendered and owns all
 * state; this island does only what HTML can't:
 *
 *   1. Selection → anchor. A text selection inside an annotatable field
 *      (`[data-rm-field]`) becomes a text anchor in the SAME canonical text the
 *      server computes (src/lib/anchor/text.ts rules, mirrored over the live
 *      DOM), written into the composer's hidden `anchor` input. Works for mouse
 *      and keyboard selections alike: the composer's "Selected text" option
 *      follows the selection, and a floating "Comment" button jumps to it.
 *   2. Highlights. Each open thread card carries its anchor in `data-rm-*`
 *      attributes; the island re-finds the quote in the live text and paints it
 *      with the CSS Custom Highlight API — no elements are inserted into the
 *      author's content, so their scripts and charts are left alone. Commented
 *      figures get a `data-rm-commented` outline.
 *   3. Navigation between the two: hover/focus a card to emphasise its passage;
 *      click a highlighted passage to jump to its card.
 *
 * Excluded from the server tsconfig (see tsconfig `exclude`) — runs in the browser.
 */

import { SKIPPED_TAGS, CONTEXT_CHARS } from '../lib/anchor/text';
import { locateQuote } from '../lib/anchor/anchor';

interface TextMap {
  readonly text: string;
  /** For each canonical character: the text node and offset it came from. */
  readonly pos: readonly (readonly [Text, number])[];
}

const WS = /\s/;

/** The canonical text of one field region — the server's rules (text.ts):
 *  text nodes in order, skipped tags excluded, whitespace runs folded, leading
 *  space dropped, trailing space trimmed. */
function buildMap(region: Element): TextMap {
  let text = '';
  const pos: [Text, number][] = [];
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentElement; el && el !== region; el = el.parentElement) {
        if (SKIPPED_TAGS.has(el.localName)) return NodeFilter.FILTER_REJECT;
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

function rangeFor(map: TextMap, start: number, length: number): Range | null {
  if (length <= 0 || start < 0 || start + length > map.pos.length) return null;
  const [sNode, sOff] = map.pos[start];
  const [eNode, eOff] = map.pos[start + length - 1];
  const r = document.createRange();
  r.setStart(sNode, sOff);
  r.setEnd(eNode, eOff + 1);
  return r;
}

/** Canonical [start, end) of the characters a range covers, or null. */
function offsetsOf(map: TextMap, range: Range): [number, number] | null {
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

function blockIdOf(el: Element | null, region: Element): string | undefined {
  for (let x = el; x && x !== region.parentElement; x = x.parentElement) {
    const explicit = x.getAttribute('data-rm-anchor');
    if (explicit) return explicit;
    if (x.localName === 'img' && x.getAttribute('src')) return `img:${x.getAttribute('src')}`;
  }
  return undefined;
}

function blockElement(region: Element, blockId: string): Element | null {
  if (blockId.startsWith('img:')) {
    const src = blockId.slice(4);
    return [...region.querySelectorAll('img')].find((img) => img.getAttribute('src') === src) ?? null;
  }
  return region.querySelector(`[data-rm-anchor="${CSS.escape(blockId)}"]`);
}

function mount(panelId: string): void {
  document.body.classList.add('rm-reviewing');
  const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;
  const regionOf = (field: string) => document.querySelector(`[data-rm-field="${CSS.escape(field)}"]`);
  const panel = () => document.getElementById(panelId);

  // ── Selection → composer ────────────────────────────────────────────────
  const floating = document.createElement('button');
  floating.type = 'button';
  floating.textContent = 'Comment';
  floating.className =
    'fixed z-50 hidden rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-md';
  document.body.append(floating);

  let pendingQuote = '';

  function applySelection(): void {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    const startEl = range
      ? range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
      : null;
    const region = startEl?.closest('[data-rm-field]');
    if (!range || !region || !region.contains(range.endContainer)) {
      floating.classList.add('hidden');
      return;
    }
    const map = buildMap(region);
    const at = offsetsOf(map, range);
    if (!at) return;
    const [s, e] = at;
    const quote = map.text.slice(s, e);
    const anchor = {
      kind: 'text',
      field: region.getAttribute('data-rm-field'),
      quote,
      prefix: map.text.slice(Math.max(0, s - CONTEXT_CHARS), s),
      suffix: map.text.slice(e, e + CONTEXT_CHARS),
      start: s,
      blockId: blockIdOf(startEl, region),
    };
    const form = document.querySelector<HTMLFormElement>('[data-rm-composer]');
    const input = form?.querySelector<HTMLInputElement>('[data-rm-anchor-input]');
    if (form && input) {
      input.value = JSON.stringify(anchor);
      const option = form.querySelector<HTMLOptionElement>('[data-rm-selection-option]');
      const select = option?.parentElement as HTMLSelectElement | null;
      if (option && select) {
        option.disabled = false;
        select.value = 'selection';
      }
      const preview = form.querySelector<HTMLElement>('[data-rm-quote-preview]');
      if (preview) {
        preview.textContent = quote;
        preview.classList.remove('hidden');
      }
    }
    pendingQuote = quote;
    const rect = range.getBoundingClientRect();
    floating.style.top = `${Math.min(window.innerHeight - 40, rect.bottom + 8)}px`;
    floating.style.left = `${Math.max(8, rect.left)}px`;
    floating.classList.remove('hidden');
  }

  let selTimer = 0;
  document.addEventListener('selectionchange', () => {
    window.clearTimeout(selTimer);
    selTimer = window.setTimeout(applySelection, 150);
  });

  floating.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
  floating.addEventListener('click', () => {
    floating.classList.add('hidden');
    const form = document.querySelector<HTMLFormElement>('[data-rm-composer]');
    const target = form?.querySelector<HTMLTextAreaElement>('textarea[name=body]') ??
      panel()?.querySelector<HTMLInputElement>('input[name=name]');
    target?.scrollIntoView({ block: 'center' });
    target?.focus();
    if (!form && pendingQuote) target?.setAttribute('placeholder', 'Add your name first, then comment');
  });

  // ── Highlights ──────────────────────────────────────────────────────────
  const threadRanges = new Map<string, Range>();
  const threadBlocks = new Map<string, Element>();

  function paint(): void {
    threadRanges.clear();
    for (const el of threadBlocks.values()) el.removeAttribute('data-rm-commented');
    threadBlocks.clear();
    const maps = new Map<string, TextMap>();
    const mapFor = (field: string) => {
      if (!maps.has(field)) {
        const region = regionOf(field);
        if (region) maps.set(field, buildMap(region));
      }
      return maps.get(field);
    };
    const cards = panel()?.querySelectorAll<HTMLElement>('[data-rm-thread][data-rm-status=open]') ?? [];
    for (const card of cards) {
      const id = card.getAttribute('data-rm-thread')!;
      const field = card.getAttribute('data-rm-anchor-field');
      const kind = card.getAttribute('data-rm-anchor-kind');
      if (!field || !kind) continue;
      if (kind === 'block') {
        const region = regionOf(field);
        const el = region && blockElement(region, card.getAttribute('data-rm-anchor-block') ?? '');
        if (el) {
          el.setAttribute('data-rm-commented', '');
          threadBlocks.set(id, el);
        }
        continue;
      }
      const map = mapFor(field);
      const quote = card.getAttribute('data-rm-anchor-quote') ?? '';
      if (!map || !quote) continue;
      const at = locateQuote(map.text, quote, {
        prefix: card.getAttribute('data-rm-anchor-prefix') ?? '',
        suffix: card.getAttribute('data-rm-anchor-suffix') ?? '',
        start: Number(card.getAttribute('data-rm-anchor-start') ?? 0),
      });
      const range = at === null ? null : rangeFor(map, at, quote.length);
      if (range) threadRanges.set(id, range);
    }
    if (supportsHighlights) {
      CSS.highlights.set('rm-review', new Highlight(...threadRanges.values()));
      CSS.highlights.delete('rm-review-active');
    }
  }

  function activate(id: string | null): void {
    for (const [tid, el] of threadBlocks) el.setAttribute('data-rm-commented', tid === id ? 'active' : '');
    if (!supportsHighlights) return;
    const range = id ? threadRanges.get(id) : undefined;
    if (range) CSS.highlights.set('rm-review-active', new Highlight(range));
    else CSS.highlights.delete('rm-review-active');
  }

  // Card → passage.
  document.addEventListener('mouseover', (e) => {
    const card = (e.target as Element | null)?.closest?.('[data-rm-thread]');
    activate(card?.getAttribute('data-rm-thread') ?? null);
  });
  document.addEventListener('focusin', (e) => {
    const card = (e.target as Element | null)?.closest?.('[data-rm-thread]');
    if (card) activate(card.getAttribute('data-rm-thread'));
  });
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const card = target?.closest?.('[data-rm-thread]');
    // A click on the card's text (not its controls) scrolls to the passage.
    if (card && !target?.closest('button, a, textarea, input, select, form')) {
      const id = card.getAttribute('data-rm-thread')!;
      const range = threadRanges.get(id);
      const el = range?.startContainer.parentElement ?? threadBlocks.get(id);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      activate(id);
      return;
    }
    // Passage → card: a click inside a highlighted range or commented block.
    if (!target?.closest('[data-rm-field]') || !window.getSelection()?.isCollapsed) return;
    for (const [id, el] of threadBlocks) {
      if (el.contains(target)) return focusCard(id);
    }
    for (const [id, range] of threadRanges) {
      if (range.intersectsNode(target) && rangeHasPoint(range, e.clientX, e.clientY)) return focusCard(id);
    }
  });

  function rangeHasPoint(range: Range, x: number, y: number): boolean {
    return [...range.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  }

  function focusCard(id: string): void {
    const card = document.getElementById(`comment-${id}`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card?.focus({ preventScroll: true });
    activate(id);
  }

  // Repaint whenever the panel is re-rendered (every action morphs it).
  let queued = false;
  const repaint = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };
  // A posted comment consumes the reader's selection: once the panel comes
  // back with a fresh composer, drop the selection so it isn't re-applied to
  // the next comment.
  let submitted = false;
  document.addEventListener(
    'submit',
    (e) => {
      if ((e.target as Element | null)?.matches?.('[data-rm-composer]')) submitted = true;
    },
    true,
  );
  let composer = document.querySelector('[data-rm-composer]');
  new MutationObserver((records) => {
    if (!records.some((r) => (r.target as Element).closest?.(`#${panelId}`) || r.target === document.body)) return;
    const current = document.querySelector('[data-rm-composer]');
    if (current !== composer) {
      composer = current;
      if (submitted) {
        submitted = false;
        window.clearTimeout(selTimer);
        window.getSelection()?.removeAllRanges();
        floating.classList.add('hidden');
      }
    }
    repaint();
  }).observe(document.body, { childList: true, subtree: true });

  paint();
  // Deep link: /…#comment-<id> lands on the card and its passage.
  const deep = location.hash.match(/^#comment-(.+)$/);
  if (deep) focusCard(deep[1]);
}

const panelEl = document.querySelector('[data-rm-review]');
if (panelEl?.id) mount(panelEl.id);
