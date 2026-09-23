import { describe, it, expect } from 'vitest';
import { buildDocumentHead, serializeJsonLd, DEFAULT_LOCALE, type SeoDoc } from '@/lib/seo';
import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';
import type { SiteSettings } from '@/services/settings';

const def = (fields: FieldDescriptor[], overrides: Partial<CollectionDefinition> = {}): CollectionDefinition => ({
  slug: 'articles',
  name: 'Articles',
  shape: 'collection',
  fields,
  ...overrides,
});

const BLOG_FIELDS: FieldDescriptor[] = [
  { key: 'title', type: 'text', index: true },
  { key: 'slug', type: 'slug', index: true },
  { key: 'hero', type: 'media' },
  { key: 'excerpt', type: 'text' },
  { key: 'body', type: 'markdown' },
  { key: 'tags', type: 'tags', index: true },
  { key: 'seo_title', type: 'text' },
  { key: 'meta_description', type: 'text' },
  { key: 'social_image', type: 'media' },
];

const BASE_SETTINGS: SiteSettings = {
  siteName: 'The Mill',
  siteDescription: 'The default site description.',
};

function doc(data: Record<string, unknown>, overrides: Partial<SeoDoc> = {}): SeoDoc {
  return {
    id: 'doc_abc123',
    data,
    status: 'published',
    visibility: 'public',
    publishedAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

function build(
  overrides: Partial<Parameters<typeof buildDocumentHead>[0]> = {},
  data: Record<string, unknown> = {},
  docOverrides: Partial<SeoDoc> = {},
) {
  return buildDocumentHead({
    def: def(BLOG_FIELDS),
    doc: doc(data, docOverrides),
    settings: BASE_SETTINGS,
    baseUrl: 'https://example.org',
    canonicalUrl: 'https://example.org/articles/a-post',
    publicUrl: 'https://example.org/articles/a-post',
    bodyText: 'Some markdown body prose that is fairly long and descriptive for excerpting.',
    indexable: true,
    template: 'article',
    ...overrides,
  });
}

describe('buildDocumentHead', () => {
  describe('title', () => {
    it('prefers the seo_title field over titleOf', () => {
      const head = build({}, { title: 'Real Title', seo_title: 'Custom SEO Title' });
      expect(head.ogTitle).toBe('Custom SEO Title');
      expect(head.title).toBe('Custom SEO Title — The Mill');
    });

    it('falls back to titleOf (the title field) when seo_title is absent', () => {
      const head = build({}, { title: 'Real Title' });
      expect(head.ogTitle).toBe('Real Title');
      expect(head.title).toBe('Real Title — The Mill');
    });
  });

  describe('description', () => {
    it('prefers the meta_description field', () => {
      const head = build(
        {},
        { title: 'T', excerpt: 'The lead dek.', meta_description: 'A custom meta description.' },
      );
      expect(head.description).toBe('A custom meta description.');
    });

    it('falls back to the convention lead/dek field (bind.lead-aware)', () => {
      const head = build({}, { title: 'T', excerpt: 'The lead dek.' });
      expect(head.description).toBe('The lead dek.');
    });

    it('falls back to an excerpt of the body text', () => {
      const head = build({ bodyText: 'A very specific body sentence for the excerpt fallback.' }, { title: 'T' });
      expect(head.description).toContain('A very specific body sentence');
    });

    it('falls back to settings.siteDescription, and NEVER the hardcoded layout string', () => {
      const head = build({ bodyText: '' }, { title: 'T' });
      expect(head.description).toBe('The default site description.');
      expect(head.description).not.toContain('a lightweight, agent-native CMS');
    });

    it('honours an explicit bind.lead over the default heuristic', () => {
      const withBind = def(
        [
          { key: 'title', type: 'text' },
          { key: 'author', type: 'text' },
          { key: 'dek', type: 'text' },
        ],
        { bind: { lead: 'dek' } },
      );
      const head = buildDocumentHead({
        def: withBind,
        doc: doc({ title: 'T', author: 'Not the lead', dek: 'The real dek.' }),
        settings: BASE_SETTINGS,
        baseUrl: 'https://example.org',
        canonicalUrl: 'https://example.org/x',
        publicUrl: 'https://example.org/x',
        bodyText: '',
        indexable: true,
      });
      expect(head.description).toBe('The real dek.');
    });
  });

  describe('image', () => {
    it('prefers the social_image field, as an absolute URL', () => {
      const head = build({}, { title: 'T', hero: 'med_hero', social_image: 'med_social' });
      expect(head.ogImage).toBe('https://example.org/media/med_social');
    });

    it('falls back to the convention hero field (bind.hero-aware)', () => {
      const head = build({}, { title: 'T', hero: 'med_hero' });
      expect(head.ogImage).toBe('https://example.org/media/med_hero');
    });

    it('falls back to the first media field when hero is unset', () => {
      const noHero = def([
        { key: 'title', type: 'text' },
        { key: 'cover', type: 'media' },
      ]);
      const head = buildDocumentHead({
        def: noHero,
        doc: doc({ title: 'T', cover: 'med_cover' }),
        settings: BASE_SETTINGS,
        baseUrl: 'https://example.org',
        canonicalUrl: 'https://example.org/x',
        publicUrl: 'https://example.org/x',
        bodyText: '',
        indexable: true,
      });
      expect(head.ogImage).toBe('https://example.org/media/med_cover');
    });

    it('falls back to settings.logo, as an absolute URL', () => {
      const head = build(
        { settings: { ...BASE_SETTINGS, logo: 'med_logo' } },
        { title: 'T' },
      );
      expect(head.ogImage).toBe('https://example.org/media/med_logo');
    });

    it('carries alt/width/height from the resolved media field', () => {
      const head = build(
        { media: { hero: { alt: 'A hero photo', width: 1600, height: 900 } } },
        { title: 'T', hero: 'med_hero' },
      );
      expect(head.imageAlt).toBe('A hero photo');
      expect(head.imageWidth).toBe(1600);
      expect(head.imageHeight).toBe(900);
    });
  });

  describe('canonical rules', () => {
    it('sets canonical when published and public', () => {
      const head = build({}, { title: 'T' }, { status: 'published', visibility: 'public' });
      expect(head.canonical).toBe('https://example.org/articles/a-post');
    });

    it('omits canonical when unlisted, even though ogUrl is still set', () => {
      const head = build(
        { publicUrl: 'https://example.org/articles/doc_abc123' },
        { title: 'T' },
        { status: 'published', visibility: 'unlisted' },
      );
      expect(head.canonical).toBeUndefined();
      expect(head.ogUrl).toBe('https://example.org/articles/doc_abc123');
    });

    it('omits canonical when private', () => {
      const head = build({}, { title: 'T' }, { status: 'published', visibility: 'private' });
      expect(head.canonical).toBeUndefined();
    });

    it('omits canonical for an unpublished (draft/preview) document', () => {
      const head = build({}, { title: 'T' }, { status: 'draft', visibility: 'public' });
      expect(head.canonical).toBeUndefined();
    });
  });

  describe('robots', () => {
    it('sets noindex when not indexable', () => {
      expect(build({ indexable: false }, { title: 'T' }).noindex).toBe(true);
    });

    it('omits noindex when indexable', () => {
      expect(build({ indexable: true }, { title: 'T' }).noindex).toBeUndefined();
    });
  });

  describe('dates, tags, JSON-LD type', () => {
    it('carries publishedAt/updatedAt through as publishedTime/modifiedTime', () => {
      const head = build({}, { title: 'T' });
      expect(head.publishedTime).toBe('2026-07-10T00:00:00.000Z');
      expect(head.modifiedTime).toBe('2026-07-11T00:00:00.000Z');
    });

    it('reads the first tags-type field', () => {
      const head = build({}, { title: 'T', tags: ['alpha', 'beta'] });
      expect(head.tags).toEqual(['alpha', 'beta']);
    });

    it('uses BlogPosting for the article template, Article otherwise', () => {
      const article = build({ template: 'article' }, { title: 'T' });
      expect(article.jsonLd?.['@type']).toBe('BlogPosting');
      const docs = build({ template: 'docs' }, { title: 'T' });
      expect(docs.jsonLd?.['@type']).toBe('Article');
    });

    it('sets mainEntityOfPage only when canonical is set', () => {
      const withCanonical = build({}, { title: 'T' }, { status: 'published', visibility: 'public' });
      expect(withCanonical.jsonLd?.mainEntityOfPage).toBeDefined();
      const withoutCanonical = build({}, { title: 'T' }, { status: 'published', visibility: 'private' });
      expect(withoutCanonical.jsonLd?.mainEntityOfPage).toBeUndefined();
    });
  });

  it('uses the fixed language-only DEFAULT_LOCALE, never a guessed region', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(build({}, { title: 'T' }).locale).toBe('en');
  });
});

describe('serializeJsonLd', () => {
  it('escapes < > & so a </script> breakout is impossible', () => {
    const out = serializeJsonLd({ headline: 'Ship it </script><script>alert(1)</script> & win' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
    expect(out).toContain('\\u0026');
    // Round-trips back to the original string once the browser JSON-parses it
    // (the escapes are valid inside a JSON string literal).
    expect(JSON.parse(out).headline).toContain('</script>');
  });

  it('escapes U+2028/U+2029 line/paragraph separators', () => {
    const out = serializeJsonLd({ text: 'line one\u2028line two\u2029line three' });
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
  });

  it('produces valid JSON for ordinary data', () => {
    const out = serializeJsonLd({ a: 1, b: 'two' });
    expect(JSON.parse(out)).toEqual({ a: 1, b: 'two' });
  });
});
