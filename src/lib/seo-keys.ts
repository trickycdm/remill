/**
 * Author-controlled SEO override field keys (D52) — a single list shared by
 * every surface that must agree on them: the content packs that append the
 * fields (`templates/packs.ts`), the convention layout resolver (excludes
 * them from the hero/lead/body/meta slots so they never render as reading
 * content — `templates/lib/conventions.ts`), the search-text builder
 * (excludes them from the indexed/excerpted body — `services/documents`),
 * and the SEO head builder, which reads them directly by key (`lib/seo.ts`).
 * A tiny `src/lib/` module (no template/service imports) so every layer can
 * import it without a layering violation.
 */
export const SEO_FIELD_KEYS = ['seo_title', 'meta_description', 'social_image'] as const;

export function isSeoFieldKey(key: string): boolean {
  return (SEO_FIELD_KEYS as readonly string[]).includes(key);
}
