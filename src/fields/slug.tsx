/**
 * `slug` — a URL-safe identifier, optionally derived from another field. Shows
 * `beforeSave` (transform) + `unique` handling. Uniqueness itself is enforced by
 * the documents service (it needs DB access); `beforeSave` here only normalizes.
 */

import { z } from 'zod';
import { Input } from '@/components/ui';
import { FieldShell, controlProps, requiredNonEmpty } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

interface SlugConfig {
  /** When the slug value is empty, derive it from this sibling field's value. */
  readonly from?: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Max length of the raw (pre-normalisation) input the widget accepts — generous
 *  so a pasted title still normalises, but bounded (SEC-4). */
const SLUG_INPUT_MAX_LENGTH = 512;
/** Max length of the stored slug. beforeSave truncates to this so a long derived
 *  source (e.g. a huge title) can't produce an unbounded slug. */
const SLUG_MAX_LENGTH = 200;

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
  return requiredNonEmpty(z.string().max(SLUG_INPUT_MAX_LENGTH), field);
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
    // Normalize, then bound the stored length (a trailing hyphen can appear after
    // the slice, so strip it again).
    const slug = slugify(raw).slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '');
    if (!slug && ctx.field.required) {
      throw new Error(
        `Cannot derive a slug for '${ctx.field.key}': provide a value or a non-empty '${cfg.from ?? '(source)'}'.`,
      );
    }
    return slug;
  },
  EditComponent: ({ field, value, signal }) => (
    <FieldShell
      field={field}
      signal={signal}
      help="Lowercase, hyphen-separated. Auto-generated if left blank."
    >
      <Input
        {...controlProps({ field, signal }, { placeholder: 'my-item-slug', required: false })}
        type="text"
        value={value ?? ''}
        pattern={SLUG_RE.source}
      />
    </FieldShell>
  ),
  CellComponent: ({ value }) => <code class="font-mono text-sm">{value ?? ''}</code>,
};
