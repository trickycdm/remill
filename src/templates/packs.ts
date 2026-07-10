/**
 * The content-pack registry — packs are CODE (this closed registry, the
 * template-registry grain); installing one is DATA (collection rows created
 * through the standard validated pipeline). A pack bundles a reading template
 * with the collection definition(s) co-designed for it, so "start a blog"
 * needs zero presentation config on any surface: the admin Marketplace, the
 * MCP `install_pack` tool, and `POST /api/packs/:key/install` all call the
 * same `installPack` service, which loops the ordinary `createCollection`
 * (authorize + validateDefinition + outbox event — nothing bespoke).
 *
 * Import-safe for services (like keys.ts): plain data + types, no JSX. The
 * exhaustive `Record<PackKey, Pack>` means adding a key here fails the build
 * until the pack is defined.
 */

import type { CollectionDefinition } from '@/fields/types';
import type { TemplateKey } from '@/templates/keys';

export const PACK_KEYS = ['blog'] as const;
export type PackKey = (typeof PACK_KEYS)[number];

export function isPackKey(key: string): key is PackKey {
  return (PACK_KEYS as readonly string[]).includes(key);
}

export interface Pack {
  readonly key: PackKey;
  /** Human label (Marketplace card title). */
  readonly name: string;
  /** One-sentence pitch shown on every discovery surface (admin + MCP + REST). */
  readonly description: string;
  /** The reading template the pack's collections are co-designed for. */
  readonly template: TemplateKey;
  /** The collection definition(s) an install creates, in order. An ARRAY from
   *  day one — a docs-style pack may bundle several related collections. */
  readonly collections: readonly CollectionDefinition[];
}

/** The blog scaffold: co-designed for `resolveConventionLayout` — `title`→H1,
 *  `hero` (first media)→lead image, `excerpt` (first non-title text)→standfirst,
 *  `body` (markdown)→prose, `tags`→meta. Convention resolves cleanly with zero
 *  presentation config. */
export const blogCollectionScaffold: CollectionDefinition = {
  slug: 'articles',
  name: 'Articles',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    {
      key: 'hero',
      type: 'media',
      admin: { help: 'Lead image, shown full-width at the top of the article.' },
    },
    {
      key: 'excerpt',
      type: 'text',
      admin: { help: 'A one-line standfirst shown under the title.' },
    },
    { key: 'body', type: 'markdown' },
    { key: 'tags', type: 'tags', index: true },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'article',
};

export const PACKS: Record<PackKey, Pack> = {
  blog: {
    key: 'blog',
    name: 'Blog',
    description:
      'Public articles with a designed reading page: hero image, standfirst, markdown body, ' +
      'tags, share bar, and RSS out of the box.',
    template: 'article',
    collections: [blogCollectionScaffold],
  },
};

export function resolvePack(key: string): Pack | undefined {
  return isPackKey(key) ? PACKS[key] : undefined;
}
