/**
 * `tags` — a list of short string labels. Joined into `value_text` for filtering.
 * The widget is a comma-separated text input for now (Phase 4 upgrades it to a
 * token input); `beforeSave` normalizes the comma string into a string[], so the
 * validator accepts either shape (string | string[]).
 */

import { z } from 'zod';
import { Badge, Input } from '@/components/ui';
import { FieldShell, controlProps } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

/** Fallback caps when a tags field declares no `maxTags` — bound the array and
 *  each tag's length so neither is an unbounded storage/DoS vector (SEC-4). A
 *  configured `maxTags` stays authoritative. */
const TAGS_DEFAULT_MAX = 100;
const TAG_MAX_LENGTH = 100;

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
  const arr = z
    .array(z.string().min(1).max(TAG_MAX_LENGTH))
    .max(cfg.maxTags ?? TAGS_DEFAULT_MAX);
  // Accept the raw comma-string too; beforeSave splits it into a string[] and
  // re-applies the cap (the split can't be bounded by the string schema alone).
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
  beforeSave: (value, ctx) => {
    const cfg = (ctx.field.config ?? {}) as TagsConfig;
    const max = cfg.maxTags ?? TAGS_DEFAULT_MAX;
    const v = value as unknown as string[] | string | undefined;
    const tags = typeof v === 'string' ? splitTags(v) : (v ?? []);
    // Backstop the cap for the comma-string path (arrays are already capped by
    // the value schema, but the split result is only bounded here).
    if (tags.length > max) {
      throw new Error(`Too many tags for '${ctx.field.key}' (max ${max}).`);
    }
    return tags;
  },
  EditComponent: ({ field, value, signal }) => (
    <FieldShell field={field} signal={signal} help="Comma-separated (e.g. news, updates).">
      <Input
        {...controlProps({ field, signal })}
        type="text"
        value={Array.isArray(value) ? value.join(', ') : (value ?? '')}
      />
    </FieldShell>
  ),
  CellComponent: ({ value }) => (
    <span class="flex flex-wrap gap-1">
      {(Array.isArray(value) ? value : []).map((t) => (
        <Badge>{t}</Badge>
      ))}
    </span>
  ),
};
