/**
 * Pure helpers over a collection definition + document data (D35/D36) — the
 * shared answers to "what is this document's title / public URL / excerpt".
 * Type-only dependency on the field contract (the lifecycle.ts posture): no
 * registry imports here — text EXTRACTION (which needs field types) stays in
 * the services layer (buildSearchText); these helpers only shape its output.
 */

import type { CollectionDefinition } from '@/fields/types';
import { isListed, type Visibility } from '@/lib/visibility';

export { isListed, isAnonymouslyReadable } from '@/lib/visibility';

/** The minimal document shape these helpers read — structural, so queries- and
 *  service-layer records both fit without importing either layer. */
export interface DocLike {
  readonly id: string;
  readonly data: Record<string, unknown>;
  /** Document visibility (D50); optional — callers that don't carry it treat
   *  the document as public. */
  readonly visibility?: Visibility;
}

/** The collection's display-title field: an explicit binding first (`configured`
 *  arg, else the definition's `bind.title`), else the first TEXT field, else the
 *  first slug field (last resort — a slug-first collection must never render its
 *  slug as the H1 while prose is available). The SAME heuristic serves the
 *  search index, relation expansion, OG/feeds, and the reading templates — keep
 *  them identical. */
export function titleFieldOf(def: CollectionDefinition, configured?: string): string | undefined {
  for (const explicit of [configured, def.bind?.title]) {
    if (explicit && def.fields.some((f) => f.key === explicit)) return explicit;
  }
  return (
    def.fields.find((f) => f.type === 'text')?.key ?? def.fields.find((f) => f.type === 'slug')?.key
  );
}

/** A document's display title, falling back to its id (feeds/OG must never be
 *  titleless). */
export function titleOf(def: CollectionDefinition, doc: DocLike): string {
  const key = titleFieldOf(def);
  const raw = key ? doc.data[key] : undefined;
  return typeof raw === 'string' && raw.trim().length ? raw : doc.id;
}

/** A document's public URL: the indexed slug-field value when present (the
 *  pretty URL the public route resolves), else the `doc_…` id (the route
 *  accepts both). When the document's visibility (D50) is set and not
 *  `'public'`, the slug is NEVER used — the slug is guessable from the title,
 *  which defeats unlisted/private — so it always returns the `doc_…` id URL
 *  instead. A missing visibility is treated as public (unchanged behaviour).
 *  Pass `baseUrl: ''` for a relative path. */
export function publicUrlOf(def: CollectionDefinition, doc: DocLike, baseUrl: string): string {
  if (!isListed(doc)) {
    return `${baseUrl}/${def.slug}/${encodeURIComponent(doc.id)}`;
  }
  const slugField = def.fields.find((f) => f.type === 'slug' && f.index);
  const raw = slugField ? doc.data[slugField.key] : undefined;
  const ref = typeof raw === 'string' && raw.length ? raw : doc.id;
  return `${baseUrl}/${def.slug}/${encodeURIComponent(ref)}`;
}

/** Collapse whitespace and truncate to `max` chars (word-safe, `…` suffix) —
 *  the feed/OG description shape. Feed callers hand it `buildSearchText` body
 *  text; anything already short passes through unchanged. */
export function excerptFrom(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max / 2 ? lastSpace : max)}…`;
}
