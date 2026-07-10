/**
 * The render-template registry — the code side of the render surface (templates
 * are code; a collection's `template` key selects one). Parallels the field
 * registry. The `Record<TemplateKey, …>` type makes the registry EXHAUSTIVE:
 * add a key to keys.ts and the compiler demands its component here.
 */

import type { RenderTemplate } from '@/templates/types';
import { isTemplateKey, type TemplateKey } from '@/templates/keys';
import { articleTemplate } from '@/templates/article';
import { changelogTemplate } from '@/templates/changelog';
import { portfolioTemplate } from '@/templates/portfolio';
import { docsTemplate } from '@/templates/docs';

const TEMPLATES: Record<TemplateKey, RenderTemplate> = {
  article: articleTemplate,
  changelog: changelogTemplate,
  portfolio: portfolioTemplate,
  docs: docsTemplate,
};

/** Resolve a collection's `template` key to its component, or undefined when the
 *  key is unset or unknown — the caller falls back to the generic shell render. */
export function resolveTemplate(key?: string): RenderTemplate | undefined {
  return key && isTemplateKey(key) ? TEMPLATES[key] : undefined;
}

/** Discovery projection of the registry (MCP `list_templates`, REST
 *  `GET /api/templates`, the admin Marketplace): metadata only, no components. */
export function listTemplates(): { key: string; name: string; description: string }[] {
  return Object.values(TEMPLATES).map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
  }));
}
