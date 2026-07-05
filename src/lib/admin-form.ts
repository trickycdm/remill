/**
 * Coerce an admin form POST (all values are strings) into the typed shape the
 * documents service validates. This is admin-surface glue only — REST and MCP send
 * already-typed JSON, so they skip it. Keyed by field type; unknown types pass the
 * raw string through and let the field's valueSchema/beforeSave handle it.
 */

import type { CollectionDefinition } from '@/fields/types';

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
      case 'select':
        if (!present) break;
        // A multi-select posts repeated keys → array; otherwise a single string.
        out[field.key] = Array.isArray(raw) ? raw.map(String) : asString(raw);
        break;
      default:
        // text, slug, markdown, datetime, tags (CSV string), json (JSON string).
        if (present) out[field.key] = asString(raw);
    }
  }
  return out;
}
