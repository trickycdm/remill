/**
 * Coerce an admin form POST (all values are strings) into the typed shape the
 * documents service validates. This is admin-surface glue only — REST and MCP send
 * already-typed JSON, so they skip it. Keyed by field type; unknown types pass the
 * raw string through and let the field's valueSchema/beforeSave handle it.
 *
 * Blank-optional rule (COR-2): a present-but-empty string is a *present* value, so
 * `.optional()` would NOT skip it — an optional `select`/`media` would reject `''`
 * and `json.beforeSave` would `JSON.parse('')` → throw, failing the whole save.
 * So a blank value on a non-required field is OMITTED (mirroring the `number`
 * omit). Required fields still flow their `''` through, so they error as required.
 */

import type { CollectionDefinition } from '@/fields/types';
import { datetimeLocalToIso } from '@/fields/datetime';

type Raw = string | File | (string | File)[];

function asString(v: Raw): string {
  return Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '';
}

export function coerceAdminForm(
  def: CollectionDefinition,
  body: Record<string, Raw>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of def.fields) {
    const present = field.key in body;
    const raw = body[field.key];

    switch (field.type) {
      case 'boolean':
        // An unchecked checkbox is omitted from the POST → false.
        out[field.key] = present && asString(raw) !== '' && asString(raw) !== 'false';
        break;
      case 'number': {
        if (!present || asString(raw) === '') break; // optional/empty → omit
        out[field.key] = Number(asString(raw));
        break;
      }
      case 'datetime': {
        if (!present) break;
        const s = asString(raw);
        if (s === '' && !field.required) break; // blank optional → omit
        // The datetime-local widget emits a bare local value; the validator needs
        // full ISO-8601 UTC (COR-1).
        out[field.key] = datetimeLocalToIso(s);
        break;
      }
      case 'select': {
        if (!present) break;
        const multiple = (field.config as { multiple?: boolean } | undefined)?.multiple;
        if (multiple) {
          // A <select multiple> posts one key per choice → an array (requires
          // parseBody({ all: true }) in the route). A SINGLE choice posts just one
          // key, which parseBody returns as a string — normalize it to an array so
          // the z.array() schema accepts it (COR-4, one-selection edge).
          const arr = (Array.isArray(raw) ? raw : [raw]).map(asString).filter((s) => s !== '');
          if (arr.length === 0 && !field.required) break; // blank optional → omit
          out[field.key] = arr;
        } else {
          // A single select posts one string ('' from the optional '—' option).
          const s = asString(raw);
          if (s === '' && !field.required) break; // blank optional → omit
          out[field.key] = s;
        }
        break;
      }
      default: {
        // text, slug, markdown, media, tags (CSV string), json (JSON string).
        if (!present) break;
        const s = asString(raw);
        if (s === '' && !field.required) break; // blank optional → omit
        out[field.key] = s;
      }
    }
  }
  return out;
}
