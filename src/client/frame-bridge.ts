/**
 * Frame bridge (D60) — the script remill injects into a framed page. It runs
 * INSIDE the sandboxed document (an opaque origin, alongside the author's own
 * scripts) and does two jobs:
 *
 *   1. Links. The sandbox forbids navigating the shell, and a plain link would
 *      replace the framed page with a site that most likely refuses to be
 *      framed — so every link that isn't a same-document fragment opens in a
 *      new tab.
 *   2. Review. It is the review island's hands inside the frame: it reports
 *      the reader's text selection as a canonical-text anchor, paints the open
 *      threads' passages (CSS Custom Highlight API — nothing is inserted into
 *      the author's markup), and reports clicks on them. The panel, the
 *      composer and every network call stay in the shell.
 *
 * The shell treats everything this script sends as untrusted (the author's
 * scripts share this window and could send the same messages) — see
 * src/lib/frame/messages.ts. Bundled to one classic script by the
 * `remill-frame-bridge` Vite plugin and inlined by the frame content route.
 */

import { SKIPPED_TAGS } from '../lib/anchor/text';
import { locateQuote } from '../lib/anchor/anchor';
import {
  FRAME_MESSAGE,
  SHELL_MESSAGE,
  type FrameMessage,
  type PaintThread,
} from '../lib/frame/messages';
import {
  buildMap,
  rangeFor,
  quoteOf,
  blockElement,
  rangeHasPoint,
  type TextMap,
} from './review-dom';

// ── 1. Links ──────────────────────────────────────────────────────────────
document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!a || (a.getAttribute('href') ?? '').startsWith('#')) return;
    const target = a.getAttribute('target');
    if (!target || target === '_self' || target === '_top' || target === '_parent') {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  },
  true,
);

// ── 2. Review ─────────────────────────────────────────────────────────────
// Only when framed: opened directly there is no shell to talk to.
if (window.parent !== window) {
  // The whole document is the one annotatable region. `title` is skipped on
  // top of the usual tags: it is head text, not prose (the server's `document`
  // canonical profile does the same — src/lib/anchor/canonical.ts).
  const SKIPPED: ReadonlySet<string> = new Set([...SKIPPED_TAGS, 'title']);
  const region = document.documentElement;
  const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;
  const send = (message: FrameMessage) => window.parent.postMessage(message, '*');

  // Literal colours: the author's document has none of remill's tokens.
  const style = document.createElement('style');
  style.setAttribute('data-rm-frame', '');
  style.textContent =
    '::highlight(rm-review){background-color:rgba(255,196,0,.4)}' +
    '::highlight(rm-review-active){background-color:rgba(236,72,153,.3);text-decoration:underline 2px rgb(219,39,119)}' +
    '[data-rm-commented]{outline:2px dashed rgb(202,138,4);outline-offset:4px}' +
    '[data-rm-commented=active]{outline-color:rgb(219,39,119)}';
  (document.head ?? region).append(style);

  let threads: readonly PaintThread[] = [];
  let active: string | null = null;
  const ranges = new Map<string, Range>();
  const blocks = new Map<string, Element>();

  const applyActive = () => {
    for (const [id, el] of blocks)
      el.setAttribute('data-rm-commented', id === active ? 'active' : '');
    if (!supportsHighlights) return;
    const range = active ? ranges.get(active) : undefined;
    if (range) CSS.highlights.set('rm-review-active', new Highlight(range));
    else CSS.highlights.delete('rm-review-active');
  };

  const paint = () => {
    ranges.clear();
    for (const el of blocks.values()) el.removeAttribute('data-rm-commented');
    blocks.clear();
    let map: TextMap | undefined;
    for (const t of threads) {
      if (t.kind === 'block') {
        const el = blockElement(region, t.block);
        if (el) blocks.set(t.id, el);
        continue;
      }
      map ??= buildMap(region, SKIPPED);
      const at = locateQuote(map.text, t.quote, {
        prefix: t.prefix,
        suffix: t.suffix,
        start: t.start,
      });
      const range = at === null ? null : rangeFor(map, at, t.quote.length);
      if (range) ranges.set(t.id, range);
    }
    if (supportsHighlights) CSS.highlights.set('rm-review', new Highlight(...ranges.values()));
    applyActive();
  };

  // The author's scripts may render text after load (a chart legend, a
  // fetched table): repaint when the document changes, at most every 300ms.
  // Attribute changes are not observed, so our own outlines never retrigger it.
  let repaintTimer = 0;
  new MutationObserver(() => {
    if (!threads.length || repaintTimer) return;
    repaintTimer = window.setTimeout(() => {
      repaintTimer = 0;
      paint();
    }, 300);
  }).observe(region, { childList: true, subtree: true, characterData: true });

  // Selection → the shell's composer.
  let reported = false;
  const reportSelection = () => {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    const quoted = range ? quoteOf(region, range, SKIPPED) : null;
    if (!range || !quoted) {
      if (reported) send({ rm: FRAME_MESSAGE, type: 'selection', selection: null });
      reported = false;
      return;
    }
    const r = range.getBoundingClientRect();
    reported = true;
    send({
      rm: FRAME_MESSAGE,
      type: 'selection',
      selection: {
        quote: quoted.quote,
        prefix: quoted.prefix,
        suffix: quoted.suffix,
        start: quoted.start,
        ...(quoted.blockId ? { blockId: quoted.blockId } : {}),
        rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
      },
    });
  };
  let selTimer = 0;
  document.addEventListener('selectionchange', () => {
    window.clearTimeout(selTimer);
    selTimer = window.setTimeout(reportSelection, 150);
  });
  // The shell's floating "Comment" button tracks the selection's position.
  let scrollQueued = false;
  window.addEventListener(
    'scroll',
    () => {
      if (!reported || scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        reportSelection();
      });
    },
    { capture: true, passive: true },
  );

  // Passage → card: a click inside a highlighted range or commented block.
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (!target || !window.getSelection()?.isCollapsed) return;
    for (const [id, el] of blocks) {
      if (el.contains(target)) return send({ rm: FRAME_MESSAGE, type: 'focus', id });
    }
    for (const [id, range] of ranges) {
      if (range.intersectsNode(target) && rangeHasPoint(range, e.clientX, e.clientY)) {
        return send({ rm: FRAME_MESSAGE, type: 'focus', id });
      }
    }
  });

  // Instructions from the shell — and only from the shell.
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data as { rm?: unknown; type?: unknown; threads?: unknown; id?: unknown } | null;
    if (!m || m.rm !== SHELL_MESSAGE) return;
    if (m.type === 'paint' && Array.isArray(m.threads)) {
      threads = m.threads as PaintThread[];
      paint();
    } else if (m.type === 'activate') {
      active = typeof m.id === 'string' ? m.id : null;
      applyActive();
    } else if (m.type === 'reveal' && typeof m.id === 'string') {
      const el = ranges.get(m.id)?.startContainer.parentElement ?? blocks.get(m.id);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      active = m.id;
      applyActive();
    } else if (m.type === 'clear-selection') {
      window.clearTimeout(selTimer);
      window.getSelection()?.removeAllRanges();
      reported = false;
    }
  });

  const ready = () => send({ rm: FRAME_MESSAGE, type: 'ready' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}
