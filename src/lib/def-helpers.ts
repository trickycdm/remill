/**
 * Pure helpers over a collection definition + document data (D35/D36) — the
 * shared answers to "what is this document's title / public URL / excerpt".
 * Type-only dependency on the field contract (the lifecycle.ts posture): no
 * registry imports here — text EXTRACTION (which needs field types) stays in
 * the services layer (buildSearchText); these helpers only shape its output.
 */

import type { CollectionDefinition } from '@/fields/types';

/** The minimal document shape these helpers read — structural, so queries- and
 *  service-layer records both fit without importing either layer. */
export interface DocLike {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

/** The collection's display-title field: the configured `titleField` when it
 *  exists, else the first text/slug field (the SAME heuristic the search index
 *  and relation expansion use — keep them identical). */
export function titleFieldOf(def: CollectionDefinition, configured?: string): string | undefined {
  if (configured && def.fields.some((f) => f.key === configured)) return configured;
  return def.fields.find((f) => f.type === 'text' || f.type === 'slug')?.key;
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
 *  accepts both). Pass `baseUrl: ''` for a relative path. */
export function publicUrlOf(def: CollectionDefinition, doc: DocLike, baseUrl: string): string {
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
