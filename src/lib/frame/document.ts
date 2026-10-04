/**
 * Framed-document preparation (D60). In `renderMode: 'frame'` the collection's
 * FIRST `html` field is a document the author owns end to end; the viewer
 * shell shows it in a sandboxed iframe. This module answers "which html is the
 * page" and makes that html servable: a bare fragment is wrapped in a minimal
 * document, and remill's preamble is injected where it cannot push the
 * document into quirks mode.
 *
 * Pure and DOM-free (htmlparser2 — runs on Workers and in the Node test
 * runner alike).
 */

import { Parser } from 'htmlparser2';
import bridge from 'virtual:frame-bridge';
import type { CollectionDefinition } from '@/fields/types';

/** The collection's page field — the first `html` field, in `raw` and `frame`
 *  mode alike (D27). */
export function pageFieldOf(def: CollectionDefinition): string | undefined {
  return def.fields.find((f) => f.type === 'html')?.key;
}

/** The framed page's html, or null when the collection isn't frame-mode or the
 *  value is empty — callers fall back to the shell render so a page is never
 *  blank (the same contract as `rawPageHtml`). */
export function framePageHtml(
  def: CollectionDefinition,
  data: Record<string, unknown>,
): string | null {
  if (def.renderMode !== 'frame') return null;
  const key = pageFieldOf(def);
  const page = key ? data[key] : undefined;
  return typeof page === 'string' && page.trim() ? page : null;
}

/**
 * What remill injects into every framed page: the frame bridge
 * (src/client/frame-bridge.ts) — new-tab link handling, and the review
 * island's hands inside the frame. Inlined as one classic script (see the
 * `remill-frame-bridge` plugin in vite.config.ts for why it cannot be an
 * asset). `</script` cannot appear inside an inline script, so it is escaped.
 */
export const FRAME_PREAMBLE = `<script data-rm-frame>${bridge.replace(/<\/(script)/gi, '<\\/$1')}</script>`;

/** Where the preamble may go: just inside `<head>`, else just inside `<html>`,
 *  else right after the doctype — never BEFORE the doctype (quirks mode). */
function insertionPoint(html: string): { at: number; isDocument: boolean } {
  let afterDoctype = -1;
  let afterHtml = -1;
  let afterHead = -1;
  let sawContent = false;
  const parser = new Parser(
    {
      onprocessinginstruction(name) {
        if (!sawContent && afterDoctype < 0 && name.toLowerCase() === '!doctype')
          afterDoctype = parser.endIndex + 1;
      },
      onopentag(name) {
        if (name === 'html' && afterHtml < 0 && !sawContent) afterHtml = parser.endIndex + 1;
        else if (name === 'head' && afterHead < 0 && !sawContent) afterHead = parser.endIndex + 1;
        else sawContent = true;
      },
      ontext(text) {
        if (text.trim()) sawContent = true;
      },
    },
    { lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  const at = afterHead >= 0 ? afterHead : afterHtml >= 0 ? afterHtml : afterDoctype;
  return { at, isDocument: at >= 0 };
}

/**
 * Make an author's html servable in the frame: inject `preamble` into a full
 * document, or wrap a bare fragment in a minimal standards-mode document
 * first. The author's markup is otherwise untouched (D25 — verbatim, trusted).
 */
export function prepareFramedDocument(html: string, preamble: string = FRAME_PREAMBLE): string {
  const { at, isDocument } = insertionPoint(html);
  if (isDocument) return html.slice(0, at) + preamble + html.slice(at);
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `${preamble}</head><body>${html}</body></html>`
  );
}

/** The document every refused frame request answers with — one shape for a
 *  bad ticket, an expired one, a revoked link and a missing page. */
export const FRAME_NOT_FOUND_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Not available</title>' +
  '<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;' +
  'color:#55524b;background:#f6f1e3}@media (prefers-color-scheme:dark){body{color:#b9bccb;background:#191c30}}</style>' +
  '</head><body><p>This page is not available. Reload to try again.</p></body></html>';
