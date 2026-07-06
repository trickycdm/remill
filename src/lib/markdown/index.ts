/**
 * Markdown → HTML for the read/render surfaces (C1, decision D23). Workers-safe
 * (no DOM) and SAFE BY DEFAULT via micromark's defaults:
 *
 *   - `allowDangerousHtml: false` (default) — raw HTML in the source is ESCAPED
 *     and shows as text; script/iframe/event-handler injection is impossible.
 *   - `allowDangerousProtocol: false` (default) — `javascript:`/`vbscript:`/
 *     `data:` link and image destinations are stripped to safe values.
 *
 * NEVER pass `allowDangerousHtml: true` — content is agent- and user-authored
 * on three doors (SECURITY_STANDARDS.md). Rendering happens ONLY on read/detail
 * surfaces; storage keeps the raw markdown (agent-legible, D3).
 */

import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

/** Render markdown (CommonMark + GFM tables/strikethrough/autolinks/tasklists)
 *  to sanitized-by-construction HTML. */
export function renderMarkdown(md: string): string {
  return micromark(md, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}
