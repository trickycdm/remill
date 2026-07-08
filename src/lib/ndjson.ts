/**
 * NDJSON (newline-delimited JSON) helpers for import/export (D37). One JSON
 * value per line — streamable, diffable, and line-addressable, which is what
 * makes per-line import error reporting possible. Pure string/JSON work; the
 * transfer service owns the remill-specific line shapes.
 */

/** Serialize values one-per-line (trailing newline included). */
export function toNdjson(values: readonly unknown[]): string {
  return values.map((v) => JSON.stringify(v)).join('\n') + '\n';
}

export interface NdjsonLine {
  /** 1-based line number in the source text (blank lines keep their numbers). */
  readonly line: number;
  /** The parsed value, or undefined when this line failed to parse. */
  readonly value: unknown;
  /** Parse error message, when the line was not valid JSON. */
  readonly error?: string;
}

/** Parse NDJSON keeping line numbers — malformed lines become per-line errors
 *  instead of aborting the batch (the import contract). Blank lines skip. */
export function parseNdjson(text: string): NdjsonLine[] {
  const out: NdjsonLine[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      out.push({ line: i + 1, value: JSON.parse(raw) });
    } catch {
      out.push({ line: i + 1, value: undefined, error: 'Invalid JSON' });
    }
  }
  return out;
}
