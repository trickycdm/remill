/**
 * `boolean` — a true/false flag. Indexed as 1/0 in `value_num`. Rendered as a
 * Toggle (switch), which reads as an on/off state; still Datastar-bindable via
 * `data-bind` and POSTs like a checkbox (item 5).
 */

import { z } from 'zod';
import { Badge, Toggle } from '@/components/ui';
import { FieldShell } from '@/fields/field-shell';
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
    <FieldShell field={field} signal={signal}>
      <Toggle
        id={signal}
        name={field.key}
        required={field.required}
        checked={value ?? false}
        data-bind={signal}
      />
    </FieldShell>
  ),
  CellComponent: ({ value }) => (
    <Badge tone={value ? 'success' : 'neutral'} dot>
      {value ? 'Yes' : 'No'}
    </Badge>
  ),
};
