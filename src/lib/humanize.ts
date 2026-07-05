/**
 * humanizeKey / fieldLabel — turn a machine key into a human label when no explicit
 * `label` is set. Splits camelCase AND snake_case/kebab into words and sentence-
 * cases them: `siteName` → "Site name", `default_author_name` → "Default author
 * name". A fallback only — an explicit `field.label` always wins (fieldLabel).
 *
 * Used by both the edit form (FieldShell) and the list header (generated.tsx) so
 * the "no raw keys in the UI" rule lives in one place (item 3). Fixes the labels on
 * the already-seeded settings/media collections without any data change.
 */

export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → "camel Case"
    .replace(/[_-]+/g, ' ') // snake_case / kebab-case → spaces
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** The label to show for a field: an explicit `label`, else a humanized key. */
export function fieldLabel(field: { readonly label?: string; readonly key: string }): string {
  return field.label ?? humanizeKey(field.key);
}
