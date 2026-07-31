import { describe, it, expect } from 'vitest';
import { articleTemplate } from '@/templates/article';
import type { ExpandedDocument } from '@/services/documents';
import type { CollectionDefinition } from '@/fields/types';
import type { TemplateContext } from '@/templates/types';

const NOW = '2026-07-04T12:00:00Z';

const DEF: CollectionDefinition = {
  slug: 'articles',
  name: 'Articles',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', index: true },
    { key: 'slug', type: 'slug', index: true },
    { key: 'hero', type: 'media' },
    { key: 'excerpt', type: 'text' },
    { key: 'body', type: 'markdown' },
    { key: 'tags', type: 'tags', index: true },
  ],
  workflow: { draftPublish: true },
};

const DOC: ExpandedDocument = {
  id: 'doc_1',
  collection: 'articles',
  data: {
    title: 'My Post',
    slug: 'my-post',
    hero: 'med_x',
    excerpt: 'A short dek that sits under the title.',
    body: 'Just some body text with a handful of words in it.',
    tags: ['alpha', 'beta'],
  },
  status: 'published',
  createdBy: null,
  createdAt: NOW,
  updatedAt: NOW,
  publishedAt: NOW,
  publishAt: null,
  media: { hero: { id: 'med_x', alt: 'A hero photo', width: 1200, height: 630 } },
};

const CTX: TemplateContext = {
  settings: {},
  baseUrl: 'https://example.test',
  readingMinutes: 4,
  shareUrl: 'https://example.test/articles/my-post',
};

function render(ctx: TemplateContext = CTX): string {
  const Article = articleTemplate.Component;
  return String((<Article def={DEF} doc={DOC} backlinks={[]} ctx={ctx} />).toString());
}

describe('article template — the reading layout', () => {
  it('renders the hero at the top with real alt + intrinsic dimensions', () => {
    const html = render();
    expect(html).toContain('src="/media/med_x"');
    expect(html).toContain('alt="A hero photo"');
    expect(html).toContain('width="1200"');
    // The hero <figure> precedes the <h1> (hero at top, not bottom).
    expect(html.indexOf('<figure')).toBeLessThan(html.indexOf('<h1'));
  });

  it('renders the title as the H1 and the excerpt as a standfirst (not a labelled row)', () => {
    const html = render();
    expect(html).toContain('<h1');
    expect(html).toContain('My Post');
    expect(html).toContain('rm-standfirst');
    expect(html).toContain('A short dek that sits under the title.');
  });

  it('shows reading time and the published date', () => {
    const html = render();
    expect(html).toContain('4 min read');
    expect(html).toContain(`<time datetime="${NOW}"`);
  });

  it('writes the byline date in full prose (template-owned, ignores the iso default)', () => {
    const html = render();
    expect(html).toContain('Saturday, 4 July 2026');
  });

  it('renders the share bar as the perforated colophon', () => {
    const html = render();
    expect(html).toContain('rm-perf');
  });

  it('never renders the slug as a labelled field row', () => {
    const html = render();
    // No "Slug" label anywhere. (The slug VALUE may occur only inside the share
    // URL — legitimate — but never as a "Slug: my-post" content row.)
    expect(html).not.toContain('Slug');
  });

  it('renders a reader-share bar when a public share URL is present', () => {
    const html = render();
    expect(html).toContain('aria-label="Share"');
    expect(html).toContain('data-share-copy');
  });

  it('omits the share bar on a private share-link page (no shareUrl)', () => {
    const html = render({ settings: {}, baseUrl: 'https://example.test', readingMinutes: 4 });
    expect(html).not.toContain('data-share');
  });
});
