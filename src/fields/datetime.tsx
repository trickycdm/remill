/**
 * `datetime` — an ISO-8601 timestamp. Stored/indexed as the ISO string in
 * `value_text`, which is lexicographically sortable (ISO-8601 sorts as text).
 */

import { z } from 'zod';
import { Input, FormField } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const configSchema = z.object({}).strict();

type DatetimeConfig = z.infer<typeof configSchema>;

function valueSchema(_cfg: DatetimeConfig, field: FieldDescriptor) {
  const s = z.string().datetime();
  return field.required ? s : s.optional();
}

export const datetimeField: FieldType<DatetimeConfig, string> = {
  key: 'datetime',
  configSchema,
  valueSchema,
  toIndex: (v) => v ?? null,
  EditComponent: ({ field, value, signal }) => (
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description={field.admin?.help}
    >
      <Input
        id={signal}
        name={field.key}
        type="datetime-local"
        value={value ?? ''}
        required={field.required}
        data-bind={signal}
      />
    </FormField>
  ),
  CellComponent: ({ value }) => <span>{value ?? ''}</span>,
};
