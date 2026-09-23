/**
 * Server-side canonical text extraction (D55) — parses a field's rendered HTML
 * (the `html` field verbatim, or a `markdown` field through `renderMarkdown`)
 * into the canonical text defined in `./text.ts`, plus the offsets of its
 * anchorable blocks. Uses htmlparser2 (pure JS: runs on Workers and in the Node
 * test runner alike; Workers' HTMLRewriter doesn't exist in the latter).
 *
 * Blocks are what a reviewer can comment on as a whole — a chart, a widget, an
 * image. An element carrying `data-rm-anchor="<id>"` is a block with that id
 * (authors put it on anything they want comments to survive revisions); an
 * `<img>` without one is addressable by its source as `img:<src>`.
 */

import { Parser } from 'htmlparser2';
import { renderMarkdown } from '@/lib/markdown';
import type { CollectionDefinition } from '@/fields/types';
import { SKIPPED_TAGS, createTextFolder } from './text';

export interface CanonicalBlock {
  readonly id: string;
  /** Canonical-text offsets of the block's content ([start, end)). */
  readonly start: number;
  readonly end: number;
}

export interface CanonicalField {
  readonly text: string;
  readonly blocks: readonly CanonicalBlock[];
}

/** Field types whose rendered output is annotatable prose. */
export const ANNOTATABLE_FIELD_TYPES: ReadonlySet<string> = new Set(['html', 'markdown']);

/** Whether a collection has anything to annotate — the gate for the review
 *  surfaces (review render, comment tools, the overlay). */
export function hasAnnotatableFields(def: CollectionDefinition): boolean {
  return def.fields.some((f) => ANNOTATABLE_FIELD_TYPES.has(f.type));
}

export function canonicalFromHtml(html: string): CanonicalField {
  const folder = createTextFolder();
  const blocks: CanonicalBlock[] = [];
  // One frame per open element: its block id (if any) and where it started.
  const open: { name: string; blockId: string | null; start: number }[] = [];
  let skipDepth = 0;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (SKIPPED_TAGS.has(name)) skipDepth++;
        const explicit = attrs['data-rm-anchor']?.trim();
        const blockId = explicit || (name === 'img' && attrs.src ? `img:${attrs.src}` : null);
        open.push({ name, blockId, start: folder.length() });
      },
      ontext(text) {
        if (skipDepth === 0) folder.append(text);
      },
      onclosetag(name) {
        const frame = open.pop();
        if (SKIPPED_TAGS.has(name)) skipDepth = Math.max(0, skipDepth - 1);
        if (frame?.blockId) {
          blocks.push({ id: frame.blockId, start: frame.start, end: folder.length() });
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const text = folder.text();
  return {
    text,
    blocks: blocks.map((b) => ({ ...b, start: Math.min(b.start, text.length), end: Math.min(b.end, text.length) })),
  };
}

/** The canonical text of every annotatable field on a document, keyed by field
 *  key. Empty fields are omitted. */
export function canonicalDocument(
  def: CollectionDefinition,
  data: Record<string, unknown>,
): Map<string, CanonicalField> {
  const out = new Map<string, CanonicalField>();
  for (const field of def.fields) {
    if (!ANNOTATABLE_FIELD_TYPES.has(field.type)) continue;
    const raw = data[field.key];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const html = field.type === 'markdown' ? renderMarkdown(raw) : raw;
    out.set(field.key, canonicalFromHtml(html));
  }
  return out;
}
