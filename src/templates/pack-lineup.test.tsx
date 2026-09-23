/**
 * The Phase-4 pack lineup (changelog / portfolio / docs): layout-binding and
 * render-level drift guards per pack, mirroring blog-pack.test.ts — each pack's
 * scaffold must both RESOLVE to the intended slots and RENDER non-empty through
 * its template (so a template change that outgrows its scaffold fails here).
 */

import { describe, it, expect } from 'vitest';
import {
  changelogCollectionScaffold,
  portfolioCollectionScaffold,
  docsCollectionScaffold,
} from '@/templates/packs';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { changelogTemplate } from '@/templates/changelog';
import { portfolioTemplate } from '@/templates/portfolio';
import { docsTemplate } from '@/templates/docs';
import { buildDocumentHead } from '@/lib/seo';
import type { ExpandedDocument } from '@/services/documents';
import type { TemplateContext } from '@/templates/types';

const NOW = '2026-07-10T09:00:00.000Z';
const CTX: TemplateContext = { settings: {}, baseUrl: 'https://example.test', readingMinutes: 0 };

function docFor(collection: string, data: Record<string, unknown>): ExpandedDocument {
  return {
    id: 'doc_1',
    collection,
    data,
    status: 'published',
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
    publishAt: null,
  } as ExpandedDocument;
}

describe('changelog pack', () => {
  it('binds version→title with no hero/lead; date+type stay out of generic meta', () => {
    const layout = resolveConventionLayout(changelogCollectionScaffold, {
      wantHero: false,
      wantLead: false,
    });
    expect(layout.titleField?.key).toBe('version');
    expect(layout.hero).toBeUndefined();
    expect(layout.lead).toBeUndefined();
    expect(layout.body.map((f) => f.key)).toEqual(['body']);
  });

  it('renders a dated entry: version H1, release date, type badge, body — no share bar', () => {
    const html = String(
      changelogTemplate
        .Component({
          def: changelogCollectionScaffold,
          doc: docFor('changelog', {
            version: '2.4.1',
            slug: '2-4-1',
            date: '2026-07-01T00:00:00.000Z',
            type: 'fixed',
            body: 'Patched the **thing**.',
          }),
          backlinks: [],
          ctx: CTX,
        })
        ?.toString(),
    );
    expect(html).toContain('2.4.1'); // version as the H1
    expect(html).toContain('datetime="2026-07-01T00:00:00.000Z"'); // the release date, not publishedAt
    expect(html).toContain('Fixed'); // select LABEL, not raw value
    expect(html).toContain('thing'); // body prose
    expect(html).not.toContain('data-share'); // wants: {} — no share affordance
    // The bespoke header claims date/type: neither appears as a labelled row.
    expect(html).not.toContain('>Date<');
    expect(html).not.toContain('>Type<');
  });

  it('declares no capabilities — the route loads no share island, computes no reading time', () => {
    expect(changelogTemplate.wants).toEqual({});
  });
});

describe('portfolio pack', () => {
  const data = {
    title: 'remill',
    slug: 'remill',
    cover: 'med_cover1',
    summary: 'An agent-native headless data platform.',
    link: 'https://remill.me',
    body: 'Built on **Workers**.',
    tags: ['cloudflare'],
  };

  it('binds cover→hero and summary→lead; link claimed by the template, not meta', () => {
    const layout = resolveConventionLayout(portfolioCollectionScaffold);
    expect(layout.titleField?.key).toBe('title');
    expect(layout.hero?.key).toBe('cover');
    expect(layout.lead?.key).toBe('summary');
    // The D52 SEO override fields (seo_title/meta_description/social_image)
    // are excluded from every slot — never a meta row, on any pack.
    expect(layout.meta.map((f) => f.key).sort()).toEqual(['link', 'tags']);
  });

  it('renders media-first with the link-out; rejects a non-URL link value', () => {
    const doc = {
      ...docFor('projects', data),
      media: { cover: { id: 'med_cover1', alt: 'The remill admin', width: 1600, height: 900 } },
    } as unknown as ExpandedDocument;
    const html = String(
      portfolioTemplate
        .Component({
          def: portfolioCollectionScaffold,
          doc,
          backlinks: [],
          ctx: { ...CTX, shareUrl: 'https://example.test/projects/remill' },
        })
        ?.toString(),
    );
    expect(html.indexOf('<figure')).toBeLessThan(html.indexOf('<h1')); // cover leads
    expect(html).toContain('The remill admin'); // real alt
    expect(html).toContain('rm-standfirst'); // summary as the one-liner
    expect(html).toContain('href="https://remill.me"'); // the link-out
    expect(html).toContain('Visit the project');
    expect(html).not.toContain('>Link<'); // claimed — not a labelled meta row
    expect(html).toContain('data-share-copy'); // share bar present (wants.shareBar)

    // A non-URL link value never renders as an anchor.
    const bad = String(
      portfolioTemplate
        .Component({
          def: portfolioCollectionScaffold,
          doc: docFor('projects', { ...data, link: 'javascript:alert(1)' }),
          backlinks: [],
          ctx: CTX,
        })
        ?.toString(),
    );
    expect(bad).not.toContain('javascript:alert');
    expect(bad).not.toContain('Visit the project');
  });
});

describe('docs pack', () => {
  it('binds title/body with no hero/lead; related stays in the graph zone', () => {
    const layout = resolveConventionLayout(docsCollectionScaffold, {
      wantHero: false,
      wantLead: false,
    });
    expect(layout.titleField?.key).toBe('title');
    expect(layout.body.map((f) => f.key)).toEqual(['body']);
    // The D52 SEO override fields (seo_title/meta_description/social_image)
    // are excluded from every slot — never a meta row, on any pack.
    expect(layout.meta.map((f) => f.key).sort()).toEqual(['related', 'section']);
  });

  it('renders section eyebrow, title, body, and the related links with resolved titles', () => {
    const doc = {
      ...docFor('docs', {
        title: 'Authorize everything',
        slug: 'authorize-everything',
        section: 'concept',
        body: 'Every write goes through `authorize()`.',
        related: ['doc_other1'],
      }),
      relations: {
        related: [{ id: 'doc_other1', title: 'The schema engine', collection: 'docs' }],
      },
    } as unknown as ExpandedDocument;
    const html = String(
      docsTemplate
        .Component({ def: docsCollectionScaffold, doc, backlinks: [], ctx: CTX })
        ?.toString(),
    );
    expect(html).toContain('Concept'); // section LABEL as the eyebrow
    expect(html.indexOf('Concept')).toBeLessThan(html.indexOf('<h1'));
    expect(html).toContain('Authorize everything');
    expect(html).toContain('The schema engine'); // resolved relation title
    expect(html).not.toContain('data-share'); // wants: {}
  });

  it("D52 head: the docs template's lead never resolves to seo_title (the docs template opts out of a lead)", () => {
    const head = buildDocumentHead({
      def: docsCollectionScaffold,
      doc: {
        id: 'doc_1',
        data: {
          title: 'Authorize everything',
          section: 'concept',
          body: 'Every write goes through authorize().',
          seo_title: 'A punchy SEO-only title',
        },
        status: 'published',
        visibility: 'public',
        publishedAt: NOW,
        updatedAt: NOW,
      },
      settings: {},
      baseUrl: 'https://example.test',
      canonicalUrl: 'https://example.test/docs/authorize-everything',
      publicUrl: 'https://example.test/docs/authorize-everything',
      bodyText: 'Every write goes through authorize().',
      indexable: true,
      template: 'docs',
    });
    expect(head.description).not.toBe('A punchy SEO-only title');
    expect(head.description).toContain('authorize');
  });
});
