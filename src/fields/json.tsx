/**
 * `json` — an arbitrary JSON value. NOT indexable: it has no `toIndex`, so a
 * field of this type may not set `index: true` (SCHEMA_ENGINE.md). The widget
 * edits JSON as text; `beforeSave` parses a string into a value (throwing a clear
 * error on invalid JSON) and passes a non-string value through unchanged.
 */

import { z } from 'zod';
import { Textarea, FormField } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const configSchema = z.object({}).strict();

type JsonConfig = z.infer<typeof configSchema>;

function valueSchema(_cfg: JsonConfig, field: FieldDescriptor) {
  const s = z.unknown();
  return field.required ? s : s.optional();
}

export const jsonField: FieldType<JsonConfig, unknown> = {
  key: 'json',
  configSchema,
  valueSchema,
  // No toIndex: json is not meaningfully sortable/filterable.
  beforeSave: (value) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid JSON: ${msg}`, { cause: err });
      }
    }
    return value;
  },
  EditComponent: ({ field, value, signal }) => (
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description={field.admin?.help ?? 'Valid JSON.'}
    >
      <Textarea
        id={signal}
        name={field.key}
        value={value === undefined ? '' : JSON.stringify(value, null, 2)}
        rows={8}
        required={field.required}
        data-bind={signal}
      />
    </FormField>
  ),
  CellComponent: ({ value }) => (
    <code class="font-mono text-sm">
      {value === undefined ? '' : JSON.stringify(value).slice(0, 80)}
    </code>
  ),
};
