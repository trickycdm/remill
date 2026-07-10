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

export const PACK_KEYS = ['blog', 'changelog', 'portfolio', 'docs'] as const;
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

/** Changelog scaffold: version leads (the title heuristic — first text field),
 *  slug derives from it, first datetime → the release date, first select → the
 *  change-type badge (both bound bespoke by the changelog template). */
export const changelogCollectionScaffold: CollectionDefinition = {
  slug: 'changelog',
  name: 'Changelog',
  shape: 'collection',
  fields: [
    {
      key: 'version',
      type: 'text',
      required: true,
      index: true,
      admin: {
        showInList: true,
        help: 'The release name or version, e.g. 2.4.1 or "June update".',
      },
    },
    { key: 'slug', type: 'slug', config: { from: 'version' }, unique: true, index: true },
    { key: 'date', type: 'datetime', required: true, index: true },
    {
      key: 'type',
      type: 'select',
      index: true,
      config: {
        options: [
          { value: 'added', label: 'Added' },
          { value: 'changed', label: 'Changed' },
          { value: 'fixed', label: 'Fixed' },
          { value: 'security', label: 'Security' },
          { value: 'deprecated', label: 'Deprecated' },
          { value: 'removed', label: 'Removed' },
        ],
      },
    },
    { key: 'body', type: 'markdown', required: true },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'changelog',
};

/** Portfolio scaffold: cover (first media) → the full-width lead, summary
 *  (first non-title text) → the one-liner, `link` (text, pack convention) →
 *  the prominent project link-out. */
export const portfolioCollectionScaffold: CollectionDefinition = {
  slug: 'projects',
  name: 'Projects',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    {
      key: 'cover',
      type: 'media',
      admin: { help: 'Cover image, shown full-width at the top of the project page.' },
    },
    { key: 'summary', type: 'text', admin: { help: 'A one-line pitch shown under the title.' } },
    {
      key: 'link',
      type: 'text',
      admin: { help: 'The live project URL (https://…) — rendered as the link-out button.' },
    },
    { key: 'body', type: 'markdown' },
    { key: 'tags', type: 'tags', index: true },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'portfolio',
};

/** Docs scaffold: title/body plus the graph — a self-referential `related`
 *  relation (indexed, so backlinks resolve) and a section select for grouping.
 *  Prev/next ordering deliberately deferred. */
export const docsCollectionScaffold: CollectionDefinition = {
  slug: 'docs',
  name: 'Docs',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    {
      key: 'section',
      type: 'select',
      index: true,
      config: {
        options: [
          { value: 'guide', label: 'Guide' },
          { value: 'reference', label: 'Reference' },
          { value: 'concept', label: 'Concept' },
          { value: 'note', label: 'Note' },
        ],
      },
      admin: { help: 'Which part of the documentation this page belongs to.' },
    },
    { key: 'body', type: 'markdown', required: true },
    {
      key: 'related',
      type: 'relation',
      index: true,
      config: { collection: 'docs', multiple: true },
      admin: { help: 'Other doc pages this one relates to — powers Related + Referenced by.' },
    },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'docs',
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
  changelog: {
    key: 'changelog',
    name: 'Changelog',
    description:
      'Public release notes: version, release date, a change-type badge (added/changed/fixed/…), ' +
      'and a markdown body — compact dated entries, no blog furniture.',
    template: 'changelog',
    collections: [changelogCollectionScaffold],
  },
  portfolio: {
    key: 'portfolio',
    name: 'Portfolio',
    description:
      'Project showcase: a full-width cover image, one-line summary, a prominent link to the ' +
      'live project, markdown body, and tags.',
    template: 'portfolio',
    collections: [portfolioCollectionScaffold],
  },
  docs: {
    key: 'docs',
    name: 'Docs',
    description:
      'Documentation pages with the knowledge graph built in: sections, markdown body, and ' +
      'self-referential related links that power backlinks both ways.',
    template: 'docs',
    collections: [docsCollectionScaffold],
  },
};

export function resolvePack(key: string): Pack | undefined {
  return isPackKey(key) ? PACKS[key] : undefined;
}
