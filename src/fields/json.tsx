/**
 * `json` — an arbitrary JSON value. NOT indexable: it has no `toIndex`, so a
 * field of this type may not set `index: true` (SCHEMA_ENGINE.md). The widget
 * edits JSON as text; `beforeSave` parses a string into a value (throwing a clear
 * error on invalid JSON) and passes a non-string value through unchanged.
 *
 * Bounds (SEC-4): a bare `z.unknown()` was an unbounded storage/DoS vector. The
 * validator now caps serialized size and nesting depth. The admin surface sends a
 * JSON *string* (only its length is knowable pre-parse); REST/MCP send a parsed
 * value (size + depth checked). `beforeSave` re-checks depth after parsing the
 * admin string, closing that gap.
 */

import { z } from 'zod';
import { Textarea } from '@/components/ui';
import { FieldShell, controlProps } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

/** Max serialized characters (~100 KB) and max nesting depth. */
const JSON_MAX_CHARS = 100_000;
const JSON_MAX_DEPTH = 32;

/** Return a bounds-violation message for a JSON value (or its serialized string),
 *  or null if within bounds. Depth is walked iteratively so a hostile deeply
 *  nested value can't overflow the stack. A string is assumed pre-serialized, so
 *  only its length is checked (its depth is checked post-parse in beforeSave). */
export function jsonBoundsError(v: unknown): string | null {
  let serialized: string;
  try {
    serialized = typeof v === 'string' ? v : (JSON.stringify(v) ?? '');
  } catch {
    return 'JSON is not serializable (circular reference?).';
  }
  if (serialized.length > JSON_MAX_CHARS) {
    return `JSON must be at most ${JSON_MAX_CHARS} characters (got ${serialized.length}).`;
  }
  if (typeof v !== 'string') {
    const stack: Array<{ node: unknown; depth: number }> = [{ node: v, depth: 0 }];
    while (stack.length > 0) {
      const { node, depth } = stack.pop() as { node: unknown; depth: number };
      if (depth > JSON_MAX_DEPTH) {
        return `JSON nesting must be at most ${JSON_MAX_DEPTH} levels deep.`;
      }
      if (Array.isArray(node)) {
        for (const item of node) stack.push({ node: item, depth: depth + 1 });
      } else if (node !== null && typeof node === 'object') {
        for (const val of Object.values(node)) stack.push({ node: val, depth: depth + 1 });
      }
    }
  }
  return null;
}

const configSchema = z.object({}).strict();

type JsonConfig = z.infer<typeof configSchema>;

function valueSchema(_cfg: JsonConfig, field: FieldDescriptor) {
  const s = z.unknown().superRefine((v, ctx) => {
    if (v === undefined) return;
    const err = jsonBoundsError(v);
    if (err) ctx.addIssue({ code: 'custom', message: err });
  });
  return field.required ? s : s.optional();
}

export const jsonField: FieldType<JsonConfig, unknown> = {
  key: 'json',
  configSchema,
  valueSchema,
  // No toIndex: json is not meaningfully sortable/filterable.
  beforeSave: (value) => {
    if (typeof value === 'string') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid JSON: ${msg}`, { cause: err });
      }
      // The value schema only saw the string's length; enforce depth now.
      const err = jsonBoundsError(parsed);
      if (err) throw new Error(err);
      return parsed;
    }
    return value;
  },
  EditComponent: ({ field, value, signal }) => (
    <FieldShell field={field} signal={signal} help="Valid JSON.">
      <Textarea
        {...controlProps({ field, signal })}
        value={value === undefined ? '' : JSON.stringify(value, null, 2)}
        rows={8}
      />
    </FieldShell>
  ),
  CellComponent: ({ value }) => (
    <code class="font-mono text-sm">
      {value === undefined ? '' : JSON.stringify(value).slice(0, 80)}
    </code>
  ),
};
