/**
 * `slug` — a URL-safe identifier, optionally derived from another field. Shows
 * `beforeSave` (transform) + `unique` handling. Uniqueness itself is enforced by
 * the documents service (it needs DB access); `beforeSave` here only normalizes.
 */

import { z } from 'zod';
import { Input, FormField } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

interface SlugConfig {
  /** When the slug value is empty, derive it from this sibling field's value. */
  readonly from?: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Normalize any string into a slug: lowercase, non-alphanumerics → hyphens. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const configSchema = z.object({ from: z.string().optional() }).strict();

// Lenient at validation time (the user may type free text); beforeSave produces
// the canonical slug. An optional field may be omitted entirely.
function valueSchema(_cfg: SlugConfig, field: FieldDescriptor) {
  return field.required ? z.string().min(1) : z.string().optional();
}

export const slugField: FieldType<SlugConfig, string> = {
  key: 'slug',
  configSchema,
  valueSchema,
  toIndex: (v) => v ?? null,
  beforeSave: (value, ctx) => {
    const cfg = (ctx.field.config ?? {}) as SlugConfig;
    let raw = (value ?? '').trim();
    if (!raw && cfg.from) {
      const source = ctx.data[cfg.from];
      if (typeof source === 'string') raw = source;
    }
    const slug = slugify(raw);
    if (!slug && ctx.field.required) {
      throw new Error(
        `Cannot derive a slug for '${ctx.field.key}': provide a value or a non-empty '${cfg.from ?? '(source)'}'.`,
      );
    }
    return slug;
  },
  EditComponent: ({ field, value, signal }) => (
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description={field.admin?.help ?? 'Lowercase, hyphen-separated. Auto-generated if left blank.'}
    >
      <Input
        id={signal}
        name={field.key}
        type="text"
        value={value ?? ''}
        placeholder="my-post-slug"
        pattern={SLUG_RE.source}
        data-bind={signal}
      />
    </FormField>
  ),
  CellComponent: ({ value }) => <code class="font-mono text-sm">{value ?? ''}</code>,
};
