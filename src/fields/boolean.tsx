/**
 * `boolean` — a true/false flag. Indexed as 1/0 in `value_num`. The design-system
 * `Input` doesn't model a checkbox `type`, so the widget is a native checkbox
 * styled to match the token palette (still Datastar-bindable via `data-bind`).
 */

import { z } from 'zod';
import { Badge, FormField } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const configSchema = z.object({}).strict();

type BooleanConfig = z.infer<typeof configSchema>;

function valueSchema(_cfg: BooleanConfig, field: FieldDescriptor) {
  const s = z.boolean();
  return field.required ? s : s.optional();
}

export const booleanField: FieldType<BooleanConfig, boolean> = {
  key: 'boolean',
  configSchema,
  valueSchema,
  toIndex: (v) => (v === undefined ? null : v ? 1 : 0),
  EditComponent: ({ field, value, signal }) => (
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description={field.admin?.help}
    >
      <input
        id={signal}
        name={field.key}
        type="checkbox"
        checked={value ?? false}
        class="size-4 rounded border border-border-strong bg-surface text-accent accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        data-bind={signal}
      />
    </FormField>
  ),
  CellComponent: ({ value }) => (
    <Badge tone={value ? 'success' : 'neutral'} dot>
      {value ? 'Yes' : 'No'}
    </Badge>
  ),
};
