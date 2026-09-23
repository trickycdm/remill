/**
 * Convention-based field binding for reading templates. Pure — a type-only
 * dependency on the field contract (it reads `field.type`/`field.key` only, no
 * registry), so it stays trivially unit-testable. Convention lives HERE, in the
 * template layer — NOT as a presentation role baked into the schema data. A
 * convention-first template (article) co-designs its collection so this resolves
 * cleanly; on a non-conforming collection it degrades (a slot is simply absent),
 * and a collection can pin any scalar slot explicitly via `def.bind` (validated
 * on write) when convention would guess wrong.
 */

import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';
import { titleFieldOf } from '@/lib/def-helpers';
import { isSeoFieldKey } from '@/lib/seo-keys';

/** The reading composition a convention-first template renders, resolved from a
 *  collection's field shape. Slug fields are deliberately EXCLUDED everywhere
 *  (URL infrastructure, never reader content); every other field lands in
 *  exactly one bucket so nothing silently disappears. */
export interface ConventionLayout {
  /** Display-title field (the H1) — unified with OG/feeds via `titleFieldOf`
   *  (which itself honors `bind.title`). */
  readonly titleField?: FieldDescriptor;
  /** `bind.hero`, else first `media` field → the hero. */
  readonly hero?: FieldDescriptor;
  /** `bind.lead`, else first non-title text field → the standfirst/dek. */
  readonly lead?: FieldDescriptor;
  /** `markdown`/`html` fields → the body prose, in definition order. */
  readonly body: readonly FieldDescriptor[];
  /** Everything else that isn't a slug (tags, relations, extra media, …) → a
   *  quiet metadata zone, rendered as labelled rows. */
  readonly meta: readonly FieldDescriptor[];
}

/** Per-template shape opts: a template that has no hero band (docs, changelog)
 *  or no standfirst (changelog) opts out, and the unclaimed fields fall through
 *  to `meta` rather than rendering somewhere the layout has no place for. */
export interface LayoutOptions {
  /** Claim a hero slot. Default true (the article shape). */
  readonly wantHero?: boolean;
  /** Claim a lead/standfirst slot. Default true (the article shape). */
  readonly wantLead?: boolean;
}

export function resolveConventionLayout(
  def: CollectionDefinition,
  opts: LayoutOptions = {},
): ConventionLayout {
  const { wantHero = true, wantLead = true } = opts;
  const byKey = (key: string | undefined): FieldDescriptor | undefined =>
    key ? def.fields.find((f) => f.key === key) : undefined;

  const titleField = byKey(titleFieldOf(def));
  const titleKey = titleField?.key;
  // SEO override fields (seo_title/meta_description/social_image, D52) are
  // author-controlled metadata, never reading content — excluded from every
  // slot (hero/lead/body/meta) so they can't surface as an extra picture, an
  // arbitrary standfirst, or a stray labelled row. `buildDocumentHead`
  // (`lib/seo.ts`) reads them directly by key instead.
  const hero = wantHero
    ? (byKey(def.bind?.hero) ??
      def.fields.find((f) => f.type === 'media' && !isSeoFieldKey(f.key)))
    : undefined;
  const lead = wantLead
    ? (byKey(def.bind?.lead) ??
      def.fields.find((f) => f.type === 'text' && f.key !== titleKey && !isSeoFieldKey(f.key)))
    : undefined;
  const body = def.fields.filter(
    (f) => (f.type === 'markdown' || f.type === 'html') && !isSeoFieldKey(f.key),
  );

  const claimed = new Set<string>();
  if (titleField) claimed.add(titleField.key);
  if (hero) claimed.add(hero.key);
  if (lead) claimed.add(lead.key);
  for (const b of body) claimed.add(b.key);

  const meta = def.fields.filter(
    (f) => !claimed.has(f.key) && f.type !== 'slug' && !isSeoFieldKey(f.key),
  );
  return { titleField, hero, lead, body, meta };
}
