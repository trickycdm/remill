/**
 * `text` — a single-line string field. The template field type: shows the full
 * contract (steering/SCHEMA_ENGINE.md). Copy this shape when adding a field type.
 */

import { z } from 'zod';
import { Input } from '@/components/ui';
import { FieldShell, controlProps, requiredNonEmpty } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

interface TextConfig {
  readonly minLength?: number;
  readonly maxLength?: number;
}

/** Fallback cap when a text field declares no `maxLength` — a single-line value
 *  is never legitimately this long, so it bounds an unbounded storage/DoS vector
 *  (SEC-4) without capping realistic content. Configured limits stay authoritative. */
const TEXT_DEFAULT_MAX_LENGTH = 10_000;

const configSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
  })
  .strict();

function valueSchema(cfg: TextConfig, field: FieldDescriptor) {
  let s = z.string();
  if (cfg.minLength !== undefined) s = s.min(cfg.minLength);
  s = s.max(cfg.maxLength ?? TEXT_DEFAULT_MAX_LENGTH);
  return requiredNonEmpty(s, field);
}

export const textField: FieldType<TextConfig, string> = {
  key: 'text',
  configSchema,
  valueSchema,
  toIndex: (v) => v ?? null,
  EditComponent: ({ field, value, signal }) => (
    <FieldShell field={field} signal={signal}>
      <Input {...controlProps({ field, signal })} type="text" value={value ?? ''} />
    </FieldShell>
  ),
  CellComponent: ({ value }) => <span>{value ?? ''}</span>,
};
