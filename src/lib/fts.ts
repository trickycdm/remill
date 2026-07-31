/**
 * FTS5 query helpers (D28). User input is NEVER passed to MATCH raw — FTS5 has
 * its own query syntax (AND/OR/NEAR/column filters/quotes) that would let a
 * crafted `q` error out or probe unintended columns. `toFtsQuery` reduces input
 * to quoted phrase tokens (implicit AND) with a trailing prefix match.
 *
 * Snippets: the query asks snippet() to mark matches with char(1)/char(2)
 * sentinels — control characters that cannot appear in HTML-escaped output —
 * and `snippetToHtml` escapes the WHOLE snippet first, then swaps the sentinels
 * for <mark> tags. Escape-then-mark, never the reverse.
 */

/** Sentinels snippet() wraps matches in (char(1)/char(2) in src/db/queries/search.ts). */
export const SNIPPET_START = '\u0001';
export const SNIPPET_END = '\u0002';

/**
 * Compile raw user input into a safe FTS5 MATCH expression. Each whitespace
 * token becomes a double-quoted phrase (internal quotes doubled per FTS5
 * escaping); the final token gets a `*` prefix-match suffix so as-you-type
 * style queries behave. Returns null for input with no usable tokens.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""'))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** HTML for a snippet() result: escape everything, then mark the sentinels. */
export function snippetToHtml(snippet: string): string {
  return escapeHtml(snippet)
    .replaceAll(SNIPPET_START, '<mark>')
    .replaceAll(SNIPPET_END, '</mark>');
}

/** Plain text for a snippet() result (REST/MCP surfaces): drop the sentinels. */
export function snippetToText(snippet: string): string {
  return snippet.replaceAll(SNIPPET_START, '').replaceAll(SNIPPET_END, '');
}
