import { describe, it, expect } from 'vitest';
import { blogCollectionScaffold } from '@/templates/blog-pack';
import { validateDefinition } from '@/services/collections';
import { resolveTemplate } from '@/templates/registry';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { articleTemplate } from '@/templates/article';
import type { ExpandedDocument } from '@/services/documents';

describe('blog pack scaffold', () => {
  it('is a valid collection definition that selects the article template', () => {
    const def = validateDefinition(blogCollectionScaffold);
    expect(def.template).toBe('article');
    expect(resolveTemplate(def.template)).toBeDefined();
  });

  it('binds cleanly to the article convention (only tags left as meta)', () => {
    const layout = resolveConventionLayout(blogCollectionScaffold);
    expect(layout.titleField?.key).toBe('title');
    expect(layout.hero?.key).toBe('hero');
    expect(layout.lead?.key).toBe('excerpt');
    expect(layout.body.map((f) => f.key)).toEqual(['body']);
    expect(layout.meta.map((f) => f.key)).toEqual(['tags']);
  });

  it('RENDERS what it scaffolds: hero, standfirst, and body all non-empty (drift guard)', () => {
    // Pins scaffold → rendered output directly, not just scaffold → resolver:
    // if article.tsx starts expecting something the scaffold doesn't supply,
    // this fails even though the resolver test above still passes.
    const doc = {
      id: 'doc_pack1',
      collection: 'articles',
      data: {
        title: 'A scaffolded article',
        slug: 'a-scaffolded-article',
        hero: 'med_hero123',
        excerpt: 'The standfirst under the title.',
        body: 'Some **markdown** body prose.',
        tags: ['alpha'],
      },
      status: 'published',
      createdBy: 'prn_x',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      publishedAt: '2026-07-10T00:00:00.000Z',
      publishAt: null,
      media: { hero: { id: 'med_hero123', alt: 'A hero image', width: 1600, height: 900 } },
    } as unknown as ExpandedDocument;

    const html = String(
      articleTemplate.Component({
        def: blogCollectionScaffold,
        doc,
        backlinks: [],
        ctx: {
          settings: { siteName: 'remill' },
          baseUrl: 'https://example.org',
          readingMinutes: 1,
          shareUrl: 'https://example.org/articles/a-scaffolded-article',
        },
      }),
    );

    expect(html).toContain('src="/media/med_hero123"'); // hero renders
    expect(html).toContain('A hero image'); // with its real alt
    expect(html).toContain('rm-standfirst'); // dek slot renders
    expect(html).toContain('The standfirst under the title.');
    expect(html).toContain('A scaffolded article'); // H1
    expect(html).toContain('markdown'); // body prose present
    expect(html).not.toContain('a-scaffolded-article</'); // slug never reader content
  });

  it('declares the capabilities the article layout renders (reading time + share bar)', () => {
    expect(articleTemplate.wants).toEqual({ readingTime: true, shareBar: true });
  });
});
