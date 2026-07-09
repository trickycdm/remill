/**
 * The closed set of render-template keys. Kept in its own tiny module (no
 * component imports) so the collections SERVICE can validate a `template`
 * selector against it without dragging the JSX registry into the service graph.
 * The registry (registry.ts) maps each of these keys to a component and is the
 * exhaustiveness check — add a key here, then wire it there.
 */

export const TEMPLATE_KEYS = ['article'] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function isTemplateKey(key: string): key is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(key);
}
