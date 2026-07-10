/**
 * The blog "pack" (thin slice) — the DATA half that pairs with the `article`
 * template (code). A pack is just a co-designed collection definition plus the
 * template it targets; there is no installer machinery yet (deferred until a
 * second pack exists). "Install" it by creating the collection through any write
 * surface with this definition, e.g. the MCP `create_collection` tool, the REST
 * `POST /api/collections`, or a one-off script — nothing here touches the DB.
 *
 * The field shape is co-designed for `resolveConventionLayout` (src/templates/
 * lib/conventions.ts): `title`→H1, `hero`(first media)→lead image, `excerpt`
 * (first non-title text)→standfirst, `body`(markdown)→prose, `tags`→meta. So a
 * fresh blog needs zero presentation config — convention resolves cleanly.
 */

import type { CollectionDefinition } from '@/fields/types';

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
