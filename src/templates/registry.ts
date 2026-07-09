/**
 * The render-template registry — the code side of the render surface (templates
 * are code; a collection's `template` key selects one). Parallels the field
 * registry. The `Record<TemplateKey, …>` type makes the registry EXHAUSTIVE:
 * add a key to keys.ts and the compiler demands its component here.
 */

import type { RenderTemplate } from '@/templates/types';
import { isTemplateKey, type TemplateKey } from '@/templates/keys';
import { articleTemplate } from '@/templates/article';

const TEMPLATES: Record<TemplateKey, RenderTemplate> = {
  article: articleTemplate,
};

/** Resolve a collection's `template` key to its component, or undefined when the
 *  key is unset or unknown — the caller falls back to the generic shell render. */
export function resolveTemplate(key?: string): RenderTemplate | undefined {
  return key && isTemplateKey(key) ? TEMPLATES[key] : undefined;
}
