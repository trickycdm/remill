/**
 * `datetime` — an ISO-8601 timestamp. Stored/indexed as the ISO string in
 * `value_text`, which is lexicographically sortable (ISO-8601 sorts as text).
 *
 * Widget vs validator (COR-1): the admin uses `<input type="datetime-local">`,
 * which emits a bare local wall-clock value `YYYY-MM-DDTHH:MM[:SS]` (no seconds
 * guaranteed, no timezone). The validator requires a full ISO-8601 UTC string
 * (`z.string().datetime()` → `…:SSZ`). `datetimeLocalToIso` bridges the save path
 * (admin-form coercion) and `isoToDatetimeLocal` bridges the load path (below),
 * so a value round-trips both ways. The local wall-clock value is treated as UTC
 * — deterministic on Workers (no host-timezone dependence).
 */

import { z } from 'zod';
import { Input } from '@/components/ui';
import { FieldShell, controlProps } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const ISO_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** `datetime-local` value → full ISO-8601 UTC (`…:SSZ`). Adds missing seconds and
 *  a `Z`. Anything that doesn't match the local shape is returned unchanged so the
 *  validator rejects it with a clear message. */
export function datetimeLocalToIso(local: string): string {
  const m = LOCAL_RE.exec(local);
  if (!m) return local;
  const [, date, hh, mm, ss] = m;
  return `${date}T${hh}:${mm}:${ss ?? '00'}Z`;
}

/** Stored ISO-8601 → the `datetime-local` widget shape `YYYY-MM-DDTHH:MM[:SS]`.
 *  Drops a trailing `:00`/fractional/`Z` the widget can't hold; keeps non-zero
 *  seconds so they survive the round-trip. */
export function isoToDatetimeLocal(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  const [, date, hh, mm, ss] = m;
  return ss && ss !== '00' ? `${date}T${hh}:${mm}:${ss}` : `${date}T${hh}:${mm}`;
}

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
    <FieldShell field={field} signal={signal}>
      <Input
        {...controlProps({ field, signal })}
        type="datetime-local"
        step={1}
        value={value ? isoToDatetimeLocal(value) : ''}
      />
    </FieldShell>
  ),
  CellComponent: ({ value }) => <span>{value ?? ''}</span>,
};
