/**
 * `tags` — a list of short string labels. Joined into `value_text` for filtering.
 * The widget is a comma-separated text input for now (Phase 4 upgrades it to a
 * token input); `beforeSave` normalizes the comma string into a string[], so the
 * validator accepts either shape (string | string[]).
 */

import { z } from 'zod';
import { Badge, Input, FormField } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const configSchema = z
  .object({
    maxTags: z.number().int().positive().optional(),
  })
  .strict();

type TagsConfig = z.infer<typeof configSchema>;

function valueSchema(
  cfg: TagsConfig,
  field: FieldDescriptor,
): z.ZodType<string[]> {
  let arr = z.array(z.string().min(1));
  if (cfg.maxTags !== undefined) arr = arr.max(cfg.maxTags);
  // Accept the raw comma-string too; beforeSave splits it into a string[].
  const u = z.union([arr, z.string()]);
  return (field.required ? u : u.optional()) as z.ZodType<string[]>;
}

/** Split a comma string into trimmed, non-empty tags. */
function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export const tagsField: FieldType<TagsConfig, string[]> = {
  key: 'tags',
  configSchema,
  valueSchema,
  toIndex: (v) => (Array.isArray(v) && v.length ? v.join(', ') : null),
  beforeSave: (value) => {
    const v = value as unknown as string[] | string | undefined;
    if (typeof v === 'string') return splitTags(v);
    return v ?? [];
  },
  EditComponent: ({ field, value, signal }) => (
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description={field.admin?.help ?? 'Comma-separated (e.g. news, updates).'}
    >
      <Input
        id={signal}
        name={field.key}
        type="text"
        value={Array.isArray(value) ? value.join(', ') : (value ?? '')}
        required={field.required}
        placeholder={field.admin?.placeholder}
        data-bind={signal}
      />
    </FormField>
  ),
  CellComponent: ({ value }) => (
    <span class="flex flex-wrap gap-1">
      {(Array.isArray(value) ? value : []).map((t) => (
        <Badge>{t}</Badge>
      ))}
    </span>
  ),
};
