/**
 * `number` — a numeric field promoted to `value_num` for range query/sort.
 * `config.integer` switches the validator to whole numbers and the widget step.
 */

import { z } from 'zod';
import { Input } from '@/components/ui';
import { FieldShell, controlProps } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const configSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
  })
  .strict();

type NumberConfig = z.infer<typeof configSchema>;

function valueSchema(cfg: NumberConfig, field: FieldDescriptor) {
  let s = cfg.integer ? z.number().int() : z.number();
  if (cfg.min !== undefined) s = s.min(cfg.min);
  if (cfg.max !== undefined) s = s.max(cfg.max);
  return field.required ? s : s.optional();
}

export const numberField: FieldType<NumberConfig, number> = {
  key: 'number',
  configSchema,
  valueSchema,
  toIndex: (v) => v ?? null,
  EditComponent: ({ field, value, signal, config }) => (
    <FieldShell field={field} signal={signal}>
      <Input
        {...controlProps({ field, signal })}
        type="number"
        value={value ?? ''}
        min={config?.min}
        max={config?.max}
        step={config?.integer ? 1 : 'any'}
      />
    </FieldShell>
  ),
  CellComponent: ({ value }) => (
    <span>{typeof value === 'number' ? value.toLocaleString() : ''}</span>
  ),
};
