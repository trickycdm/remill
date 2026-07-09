/**
 * Convention-based field binding for reading templates. Pure — a type-only
 * dependency on the field contract (it reads `field.type`/`field.key` only, no
 * registry), so it stays trivially unit-testable. Convention lives HERE, in the
 * template layer — NOT as a presentation role baked into the schema data. A
 * convention-first template (article) co-designs its collection so this resolves
 * cleanly; on a non-conforming collection it degrades (a slot is simply absent).
 */

import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';
import { titleFieldOf } from '@/lib/def-helpers';

/** The reading composition a convention-first template renders, resolved from a
 *  collection's field shape. Slug fields are deliberately EXCLUDED everywhere
 *  (URL infrastructure, never reader content); every other field lands in
 *  exactly one bucket so nothing silently disappears. */
export interface ConventionLayout {
  /** Display-title field (the H1) — unified with OG/feeds via `titleFieldOf`. */
  readonly titleField?: FieldDescriptor;
  /** First `media` field → the hero. */
  readonly hero?: FieldDescriptor;
  /** First non-title text field → the standfirst/dek. */
  readonly lead?: FieldDescriptor;
  /** `markdown`/`html` fields → the body prose, in definition order. */
  readonly body: readonly FieldDescriptor[];
  /** Everything else that isn't a slug (tags, relations, extra media, …) → a
   *  quiet metadata zone, rendered as labelled rows. */
  readonly meta: readonly FieldDescriptor[];
}

export function resolveConventionLayout(def: CollectionDefinition): ConventionLayout {
  const titleKey = titleFieldOf(def);
  const titleField = titleKey ? def.fields.find((f) => f.key === titleKey) : undefined;
  const hero = def.fields.find((f) => f.type === 'media');
  const lead = def.fields.find((f) => f.type === 'text' && f.key !== titleKey);
  const body = def.fields.filter((f) => f.type === 'markdown' || f.type === 'html');

  const claimed = new Set<string>();
  if (titleField) claimed.add(titleField.key);
  if (hero) claimed.add(hero.key);
  if (lead) claimed.add(lead.key);
  for (const b of body) claimed.add(b.key);

  const meta = def.fields.filter((f) => !claimed.has(f.key) && f.type !== 'slug');
  return { titleField, hero, lead, body, meta };
}
