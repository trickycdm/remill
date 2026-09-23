import { describe, it, expect } from 'vitest';
import { xmlEscape, rssXml, sitemapXml, robotsTxt } from '@/lib/feeds';
import { titleFieldOf, titleOf, publicUrlOf, excerptFrom } from '@/lib/def-helpers';
import type { CollectionDefinition } from '@/fields/types';

describe('feeds (D35) — pure builders', () => {
  it('xmlEscape covers all five XML metacharacters', () => {
    expect(xmlEscape(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });

  it('rssXml escapes injected markup in every value position', () => {
    const xml = rssXml({
      siteName: 'Site <&>',
      siteDescription: 'desc "quoted"',
      baseUrl: 'https://ex.com',
      items: [
        {
          title: 'Hello <script>alert(1)</script>',
          url: 'https://ex.com/posts/hello?a=1&b=2',
          excerpt: "5 < 6 & 7 > 4 'quote'",
          publishedAt: '2026-07-08T12:00:00Z',
          id: 'doc_x',
        },
      ],
    });
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('Hello &lt;script&gt;');
    expect(xml).toContain('a=1&amp;b=2');
    expect(xml).toContain('<pubDate>Wed, 08 Jul 2026 12:00:00 GMT</pubDate>');
    expect(xml).toContain('<guid isPermaLink="false">doc_x</guid>');
    expect(xml).toContain('Site &lt;&amp;&gt;');
  });

  it('rssXml omits description/pubDate when empty, keeps the channel valid', () => {
    const xml = rssXml({ siteName: 's', siteDescription: '', baseUrl: '', items: [{ title: 't', url: '/c/x', excerpt: '', publishedAt: null, id: 'doc_y' }] });
    expect(xml).not.toContain('<description></description>'.replace('</description>', '</description>\n    <pubDate'));
    expect(xml).not.toContain('<pubDate>');
    expect(xml).toContain('<link>/</link>'); // empty baseUrl falls back to '/'
  });

  it('sitemapXml emits loc + lastmod, escaped', () => {
    const xml = sitemapXml([
      { loc: 'https://ex.com/' },
      { loc: 'https://ex.com/posts/a&b', lastmod: '2026-07-08T00:00:00Z' },
    ]);
    expect(xml).toContain('<loc>https://ex.com/posts/a&amp;b</loc>');
    expect(xml).toContain('<lastmod>2026-07-08T00:00:00Z</lastmod>');
    expect((xml.match(/<url>/g) ?? []).length).toBe(2);
  });

  it('robotsTxt disallows every protected surface and names the sitemap', () => {
    const txt = robotsTxt('https://ex.com');
    for (const path of ['/admin', '/api', '/mcp', '/auth']) {
      expect(txt).toContain(`Disallow: ${path}`);
    }
    expect(txt).toContain('Sitemap: https://ex.com/sitemap.xml');
  });

  it('robotsTxt does NOT disallow /s/ — share links carry noindex instead (D51)', () => {
    expect(robotsTxt('https://ex.com')).not.toContain('Disallow: /s/');
  });
});

describe('def-helpers (D35/D36)', () => {
  const DEF: CollectionDefinition = {
    slug: 'posts',
    name: 'Posts',
    shape: 'collection',
    fields: [
      { key: 'title', type: 'text', required: true, index: true },
      { key: 'slug', type: 'slug', config: { from: 'title' }, index: true },
      { key: 'body', type: 'markdown' },
    ],
    workflow: { draftPublish: true },
  };

  it('titleFieldOf: configured override, else first text/slug field', () => {
    expect(titleFieldOf(DEF)).toBe('title');
    expect(titleFieldOf(DEF, 'slug')).toBe('slug');
    expect(titleFieldOf(DEF, 'missing')).toBe('title');
    expect(titleFieldOf({ ...DEF, fields: [{ key: 'n', type: 'number' }] })).toBeUndefined();
  });

  it('titleOf falls back to the doc id when the title value is empty', () => {
    expect(titleOf(DEF, { id: 'doc_a', data: { title: 'Hi' } })).toBe('Hi');
    expect(titleOf(DEF, { id: 'doc_a', data: { title: '  ' } })).toBe('doc_a');
    expect(titleOf(DEF, { id: 'doc_a', data: {} })).toBe('doc_a');
  });

  it('publicUrlOf prefers the indexed slug value, falls back to the id', () => {
    expect(publicUrlOf(DEF, { id: 'doc_a', data: { slug: 'hello-world' } }, 'https://ex.com')).toBe(
      'https://ex.com/posts/hello-world',
    );
    expect(publicUrlOf(DEF, { id: 'doc_a', data: {} }, '')).toBe('/posts/doc_a');
    // A slug field without index:true does not make public URLs (the route
    // resolves slugs through the index) — id fallback.
    const noIndex = { ...DEF, fields: [{ key: 'slug', type: 'slug' as const }] };
    expect(publicUrlOf(noIndex, { id: 'doc_b', data: { slug: 'x' } }, '')).toBe('/posts/doc_b');
  });

  it('excerptFrom collapses whitespace and truncates word-safe at the cap', () => {
    expect(excerptFrom('a\n\n b\t c')).toBe('a b c');
    const long = 'word '.repeat(60).trim();
    const out = excerptFrom(long);
    expect(out.length).toBeLessThanOrEqual(161); // 160 + ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/); // cut on a word boundary, not mid-word
  });
});
