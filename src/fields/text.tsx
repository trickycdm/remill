/**
 * `text` — a single-line string field. The template field type: shows the full
 * contract (steering/SCHEMA_ENGINE.md). Copy this shape when adding a field type.
 */

import { z } from 'zod';
import { Input, FormField } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

interface TextConfig {
  readonly minLength?: number;
  readonly maxLength?: number;
}

const configSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
  })
  .strict();

function valueSchema(cfg: TextConfig, field: FieldDescriptor) {
  let s = z.string();
  if (cfg.minLength !== undefined) s = s.min(cfg.minLength);
  if (cfg.maxLength !== undefined) s = s.max(cfg.maxLength);
  // A required field must be non-empty; an optional one may be omitted.
  return field.required ? s.min(Math.max(1, cfg.minLength ?? 1)) : s.optional();
}

export const textField: FieldType<TextConfig, string> = {
  key: 'text',
  configSchema,
  valueSchema,
  toIndex: (v) => v ?? null,
  EditComponent: ({ field, value, signal }) => (
    <FormField fieldId={signal} label={field.label ?? field.key} required={field.required}>
      <Input
        id={signal}
        name={field.key}
        type="text"
        value={value ?? ''}
        required={field.required}
        placeholder={field.admin?.placeholder}
        data-bind={signal}
      />
    </FormField>
  ),
  CellComponent: ({ value }) => <span>{value ?? ''}</span>,
};
