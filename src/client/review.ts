/**
 * Review island (D55) — the browser half of the review overlay. The panel
 * (src/components/review/review-panel.tsx) is server-rendered and owns all
 * state; this island does only what HTML can't:
 *
 *   1. Selection → anchor. A text selection in the document becomes a text
 *      anchor in the SAME canonical text the server computes (src/lib/anchor/
 *      text.ts rules, mirrored over the live DOM), written into the composer's
 *      hidden `anchor` input. Works for mouse and keyboard selections alike:
 *      the composer's "Selected text" option follows the selection, and a
 *      floating "Comment" button jumps to it.
 *   2. Highlights. Each open thread card carries its anchor in `data-rm-*`
 *      attributes; the quote is re-found in the live text and painted with the
 *      CSS Custom Highlight API — no elements are inserted into the author's
 *      content, so their scripts and charts are left alone. Commented figures
 *      get a `data-rm-commented` outline.
 *   3. Navigation between the two: hover/focus a card to emphasise its passage;
 *      click a highlighted passage to jump to its card.
 *
 * WHERE the document is differs by render mode, behind one `ReviewDocument`:
 *   - `domDocument` — the annotatable fields (`[data-rm-field]`) sit in this
 *     page (shell mode).
 *   - `frameDocument` — the page is a sandboxed iframe (`iframe[data-rm-frame]`,
 *     D60). The island cannot reach into an opaque origin, so the frame bridge
 *     (src/client/frame-bridge.ts) does the DOM work and the two talk by
 *     postMessage. Everything arriving from the frame is untrusted and
 *     validated (src/lib/frame/messages.ts).
 *
 * Excluded from the server tsconfig (see tsconfig `exclude`) — runs in the browser.
 */

import { SKIPPED_TAGS } from '../lib/anchor/text';
import { locateQuote } from '../lib/anchor/anchor';
import { SHELL_MESSAGE, parseFrameMessage, type PaintThread, type ShellMessage } from '../lib/frame/messages';
import {
  buildMap,
  rangeFor,
  quoteOf,
  blockElement,
  startElementOf,
  rangeHasPoint,
  type TextMap,
} from './review-dom';

/** One open thread's anchor, as read off its card. */
type Thread = PaintThread & { readonly field: string };

/** What the reader has selected: the anchor for the composer, and where on
 *  THIS page's viewport to float the "Comment" button. */
interface Selected {
  readonly anchor: Record<string, unknown>;
  readonly quote: string;
  readonly at: { readonly left: number; readonly bottom: number };
}

/** The document under review, wherever it lives. */
interface ReviewDocument {
  onSelection(cb: (selected: Selected | null) => void): void;
  paint(threads: readonly Thread[]): void;
  activate(id: string | null): void;
  /** Scroll a thread's passage into view. */
  reveal(id: string): void;
  onPassageClick(cb: (id: string) => void): void;
  clearSelection(): void;
}

// ── Same-document adapter (shell mode) ──────────────────────────────────────

function domDocument(): ReviewDocument {
  const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;
  const regionOf = (field: string) => document.querySelector(`[data-rm-field="${CSS.escape(field)}"]`);
  const ranges = new Map<string, Range>();
  const blocks = new Map<string, Element>();
  let selTimer = 0;

  function activate(id: string | null): void {
    for (const [tid, el] of blocks) el.setAttribute('data-rm-commented', tid === id ? 'active' : '');
    if (!supportsHighlights) return;
    const range = id ? ranges.get(id) : undefined;
    if (range) CSS.highlights.set('rm-review-active', new Highlight(range));
    else CSS.highlights.delete('rm-review-active');
  }

  return {
    onSelection(cb) {
      const apply = () => {
        const sel = window.getSelection();
        const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
        const region = range ? startElementOf(range)?.closest('[data-rm-field]') : null;
        if (!range || !region || !region.contains(range.endContainer)) return cb(null);
        const quoted = quoteOf(region, range, SKIPPED_TAGS);
        if (!quoted) return;
        const rect = range.getBoundingClientRect();
        cb({
          anchor: { kind: 'text', field: region.getAttribute('data-rm-field'), ...quoted },
          quote: quoted.quote,
          at: { left: rect.left, bottom: rect.bottom },
        });
      };
      document.addEventListener('selectionchange', () => {
        window.clearTimeout(selTimer);
        selTimer = window.setTimeout(apply, 150);
      });
    },

    paint(threads) {
      ranges.clear();
      for (const el of blocks.values()) el.removeAttribute('data-rm-commented');
      blocks.clear();
      const maps = new Map<string, TextMap>();
      const mapFor = (field: string) => {
        if (!maps.has(field)) {
          const region = regionOf(field);
          if (region) maps.set(field, buildMap(region, SKIPPED_TAGS));
        }
        return maps.get(field);
      };
      for (const t of threads) {
        if (t.kind === 'block') {
          const region = regionOf(t.field);
          const el = region && blockElement(region, t.block);
          if (el) {
            el.setAttribute('data-rm-commented', '');
            blocks.set(t.id, el);
          }
          continue;
        }
        const map = mapFor(t.field);
        if (!map) continue;
        const at = locateQuote(map.text, t.quote, { prefix: t.prefix, suffix: t.suffix, start: t.start });
        const range = at === null ? null : rangeFor(map, at, t.quote.length);
        if (range) ranges.set(t.id, range);
      }
      if (supportsHighlights) {
        CSS.highlights.set('rm-review', new Highlight(...ranges.values()));
        CSS.highlights.delete('rm-review-active');
      }
    },

    activate,

    reveal(id) {
      const el = ranges.get(id)?.startContainer.parentElement ?? blocks.get(id);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      activate(id);
    },

    onPassageClick(cb) {
      document.addEventListener('click', (e) => {
        const target = e.target as Element | null;
        if (!target?.closest('[data-rm-field]') || !window.getSelection()?.isCollapsed) return;
        for (const [id, el] of blocks) {
          if (el.contains(target)) return cb(id);
        }
        for (const [id, range] of ranges) {
          if (range.intersectsNode(target) && rangeHasPoint(range, e.clientX, e.clientY)) return cb(id);
        }
      });
    },

    clearSelection() {
      window.clearTimeout(selTimer);
      window.getSelection()?.removeAllRanges();
    },
  };
}

// ── Framed adapter (frame mode, D60) ────────────────────────────────────────

function frameDocument(iframe: HTMLIFrameElement): ReviewDocument {
  const field = iframe.getAttribute('data-rm-field') ?? '';
  let onSelection: (selected: Selected | null) => void = () => {};
  let onPassageClick: (id: string) => void = () => {};
  let threads: readonly PaintThread[] = [];
  let active: string | null = null;

  // The frame is an opaque origin, so there is no target origin to name; the
  // messages carry only thread ids and quotes of the document's OWN text.
  const send = (message: ShellMessage) => iframe.contentWindow?.postMessage(message, '*');

  window.addEventListener('message', (e) => {
    // Only this iframe's window — and even then, only well-formed messages.
    if (e.source !== iframe.contentWindow) return;
    const message = parseFrameMessage(e.data);
    if (!message) return;
    if (message.type === 'ready') {
      // The bridge (re)loaded: bring it up to date.
      send({ rm: SHELL_MESSAGE, type: 'paint', threads });
      send({ rm: SHELL_MESSAGE, type: 'activate', id: active });
    } else if (message.type === 'focus') {
      onPassageClick(message.id);
    } else if (!message.selection) {
      onSelection(null);
    } else {
      const { rect, ...quoted } = message.selection;
      // The frame reports its own viewport; place the button in ours, kept
      // inside the frame's box whatever coordinates were claimed.
      const box = iframe.getBoundingClientRect();
      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
      onSelection({
        anchor: { kind: 'text', field, ...quoted },
        quote: quoted.quote,
        at: {
          left: clamp(box.left + rect.left, box.left, box.right - 96),
          bottom: clamp(box.top + rect.bottom, box.top, box.bottom - 40),
        },
      });
    }
  });

  return {
    onSelection: (cb) => void (onSelection = cb),
    paint(next) {
      // The frame is ONE region; the shell knows which field it is.
      threads = next.filter((t) => t.field === field).map(({ field: _field, ...t }) => t);
      active = null;
      send({ rm: SHELL_MESSAGE, type: 'paint', threads });
    },
    activate(id) {
      active = id;
      send({ rm: SHELL_MESSAGE, type: 'activate', id });
    },
    reveal(id) {
      active = id;
      send({ rm: SHELL_MESSAGE, type: 'reveal', id });
    },
    onPassageClick: (cb) => void (onPassageClick = cb),
    clearSelection: () => send({ rm: SHELL_MESSAGE, type: 'clear-selection' }),
  };
}

// ── The island ──────────────────────────────────────────────────────────────

/** The open threads' anchors, read off the panel's cards. */
function threadsOf(panel: Element | null): Thread[] {
  const out: Thread[] = [];
  for (const card of panel?.querySelectorAll<HTMLElement>('[data-rm-thread][data-rm-status=open]') ?? []) {
    const id = card.getAttribute('data-rm-thread')!;
    const field = card.getAttribute('data-rm-anchor-field');
    const kind = card.getAttribute('data-rm-anchor-kind');
    if (!field || !kind) continue;
    if (kind === 'block') {
      out.push({ id, field, kind: 'block', block: card.getAttribute('data-rm-anchor-block') ?? '' });
      continue;
    }
    const quote = card.getAttribute('data-rm-anchor-quote') ?? '';
    if (!quote) continue;
    out.push({
      id,
      field,
      kind: 'text',
      quote,
      prefix: card.getAttribute('data-rm-anchor-prefix') ?? '',
      suffix: card.getAttribute('data-rm-anchor-suffix') ?? '',
      start: Number(card.getAttribute('data-rm-anchor-start') ?? 0),
    });
  }
  return out;
}

function mount(panelId: string): void {
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-rm-frame]');
  const doc = iframe ? frameDocument(iframe) : domDocument();
  // Shell mode docks the panel beside the page; the framed viewer lays it out
  // itself (the panel is a column of the viewer, not an overlay).
  if (!iframe) document.body.classList.add('rm-reviewing');
  const panel = () => document.getElementById(panelId);

  // ── Selection → composer ────────────────────────────────────────────────
  const floating = document.createElement('button');
  floating.type = 'button';
  floating.textContent = 'Comment';
  floating.className =
    'fixed z-50 hidden rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-md';
  document.body.append(floating);

  let pendingQuote = '';

  doc.onSelection((selected) => {
    if (!selected) {
      floating.classList.add('hidden');
      return;
    }
    const form = document.querySelector<HTMLFormElement>('[data-rm-composer]');
    const input = form?.querySelector<HTMLInputElement>('[data-rm-anchor-input]');
    if (form && input) {
      input.value = JSON.stringify(selected.anchor);
      const option = form.querySelector<HTMLOptionElement>('[data-rm-selection-option]');
      const select = option?.parentElement as HTMLSelectElement | null;
      if (option && select) {
        option.disabled = false;
        select.value = 'selection';
      }
      const preview = form.querySelector<HTMLElement>('[data-rm-quote-preview]');
      if (preview) {
        preview.textContent = selected.quote;
        preview.classList.remove('hidden');
      }
    }
    pendingQuote = selected.quote;
    floating.style.top = `${Math.min(window.innerHeight - 40, selected.at.bottom + 8)}px`;
    floating.style.left = `${Math.max(8, selected.at.left)}px`;
    floating.classList.remove('hidden');
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

  // ── Highlights + navigation ─────────────────────────────────────────────
  const paint = () => doc.paint(threadsOf(panel()));

  function focusCard(id: string): void {
    const card = document.getElementById(`comment-${id}`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card?.focus({ preventScroll: true });
    doc.activate(id);
  }

  // Card → passage.
  document.addEventListener('mouseover', (e) => {
    const card = (e.target as Element | null)?.closest?.('[data-rm-thread]');
    doc.activate(card?.getAttribute('data-rm-thread') ?? null);
  });
  document.addEventListener('focusin', (e) => {
    const card = (e.target as Element | null)?.closest?.('[data-rm-thread]');
    if (card) doc.activate(card.getAttribute('data-rm-thread'));
  });
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const card = target?.closest?.('[data-rm-thread]');
    // A click on the card's text (not its controls) scrolls to the passage.
    if (card && !target?.closest('button, a, textarea, input, select, form')) {
      doc.reveal(card.getAttribute('data-rm-thread')!);
    }
  });
  // Passage → card.
  doc.onPassageClick(focusCard);

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
        doc.clearSelection();
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
