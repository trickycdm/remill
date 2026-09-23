/**
 * Canonical text — the ONE definition of "the text of an annotatable field"
 * that both the server (anchor validation + re-anchoring, D55) and the browser
 * review island compute, so a character offset means the same thing on both
 * sides. Deliberately DOM-free and dependency-free: the island imports this
 * module as-is.
 *
 * The rules (textContent semantics, then whitespace folding):
 *   1. Text nodes are concatenated in document order. Nothing is inserted
 *      between elements (`<p>a</p><p>b</p>` → "ab"); whitespace the source
 *      already has between them is a text node like any other (so rendered
 *      markdown, which puts a newline between blocks, reads "a b").
 *   2. Text inside SKIPPED_TAGS is excluded (scripts/styles aren't prose).
 *   3. Every whitespace run folds to one space; leading whitespace is dropped;
 *      a trailing space is trimmed at the end.
 */

/** Elements whose text content never counts as annotatable prose. */
export const SKIPPED_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'noscript', 'template']);

/** Characters of context stored either side of a quote. */
export const CONTEXT_CHARS = 32;

/** Longest quote an anchor may hold (a paragraph or two, not a chapter). */
export const MAX_QUOTE_CHARS = 1000;

const WS = /\s/;

/** Incremental whitespace folder: feed text chunks in document order and read
 *  `length()` between chunks to take offsets. */
export interface TextFolder {
  append(chunk: string): void;
  /** Current folded length — the offset the next character will land at. */
  length(): number;
  /** The folded text with any trailing space trimmed. */
  text(): string;
}

export function createTextFolder(): TextFolder {
  let out = '';
  return {
    append(chunk) {
      for (const ch of chunk) {
        if (WS.test(ch)) {
          if (out.length > 0 && out[out.length - 1] !== ' ') out += ' ';
        } else {
          out += ch;
        }
      }
    },
    length: () => out.length,
    text: () => (out.endsWith(' ') ? out.slice(0, -1) : out),
  };
}

/** Fold a standalone string the same way (for quotes and context). */
export function foldWhitespace(s: string): string {
  const f = createTextFolder();
  f.append(s);
  return f.text();
}
