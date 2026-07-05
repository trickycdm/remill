/**
 * `select` — a choice from a fixed option list, single or `multiple`. The
 * validator is an enum built from the configured option values at validate time,
 * so an out-of-range choice is rejected on every surface.
 */

import { z } from 'zod';
import { Select } from '@/components/ui';
import { FieldShell } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const configSchema = z
  .object({
    options: z
      .array(z.object({ value: z.string(), label: z.string() }).strict())
      .min(1),
    multiple: z.boolean().optional(),
  })
  .strict();

type SelectConfig = z.infer<typeof configSchema>;
type SelectValue = string | string[];

function valueSchema(
  cfg: SelectConfig,
  field: FieldDescriptor,
): z.ZodType<SelectValue> {
  const values = cfg.options.map((o) => o.value);
  const one = z.enum(values);
  if (cfg.multiple) {
    const arr = z.array(one);
    return (field.required ? arr.min(1) : arr.optional()) as z.ZodType<SelectValue>;
  }
  return (field.required ? one : one.optional()) as z.ZodType<SelectValue>;
}

export const selectField: FieldType<SelectConfig, SelectValue> = {
  key: 'select',
  configSchema,
  valueSchema,
  toIndex: (v) => {
    if (v === undefined) return null;
    return Array.isArray(v) ? v.join(', ') : v;
  },
  EditComponent: ({ field, value, signal, config }) => {
    const chosen = new Set(
      Array.isArray(value) ? value : value != null ? [value] : [],
    );
    const options = config.options.map((o) => (
      <option value={o.value} selected={chosen.has(o.value)}>
        {o.label}
      </option>
    ));
    // select owns its control wiring (two widget shapes, no shared value/
    // placeholder), so it uses FieldShell only for the labelled wrapper.
    return (
      <FieldShell field={field} signal={signal}>
        {config.multiple ? (
          <select
            id={signal}
            name={field.key}
            multiple
            required={field.required}
            data-bind={signal}
            class="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {options}
          </select>
        ) : (
          <Select id={signal} name={field.key} required={field.required} data-bind={signal}>
            {field.required ? null : <option value="">—</option>}
            {options}
          </Select>
        )}
      </FieldShell>
    );
  },
  // The cell now receives config (TD-2), so it renders each stored value's human
  // label from the option list — falling back to the raw value if unmapped.
  CellComponent: ({ value, config }) => {
    const labelFor = (v: string) => config.options.find((o) => o.value === v)?.label ?? v;
    const labels = Array.isArray(value)
      ? value.map(labelFor)
      : value != null
        ? [labelFor(value)]
        : [];
    return <span>{labels.join(', ')}</span>;
  },
};
