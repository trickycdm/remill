/**
 * Which `html` field is the page (D27/D60/D63): in `raw`, `frame` and `inline`
 * render modes alike, the collection's FIRST `html` field is a document the
 * author owns end to end.
 */

import type { CollectionDefinition } from '@/fields/types';

/** The collection's page field — the first `html` field. */
export function pageFieldOf(def: CollectionDefinition): string | undefined {
  return def.fields.find((f) => f.type === 'html')?.key;
}
