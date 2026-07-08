/**
 * Feed/sitemap/robots builders (D35) — PURE functions: pre-extracted strings in,
 * XML/text out. No DB, no field types, no request context; the discovery
 * service (src/services/discovery) assembles the inputs through the gated read
 * pipeline. Every interpolated value is XML-escaped here — never trust a title.
 */

/** Escape a value for XML text/attribute position. */
export function xmlEscape(v: string): string {
  return v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export interface FeedItem {
  readonly title: string;
  /** Absolute URL (the service builds it via publicUrlOf + resolveBaseUrl). */
  readonly url: string;
  readonly excerpt: string;
  /** ISO-8601; rendered as RFC-822 for RSS. */
  readonly publishedAt: string | null;
  /** Stable guid — the document id. */
  readonly id: string;
}

function rfc822(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toUTCString();
}

/** RSS 2.0 — one merged site feed (or one collection's, when narrowed). */
export function rssXml(opts: {
  readonly siteName: string;
  readonly siteDescription: string;
  readonly baseUrl: string;
  readonly items: readonly FeedItem[];
}): string {
  const items = opts.items
    .map((it) => {
      const pub = rfc822(it.publishedAt);
      return [
        '    <item>',
        `      <title>${xmlEscape(it.title)}</title>`,
        `      <link>${xmlEscape(it.url)}</link>`,
        `      <guid isPermaLink="false">${xmlEscape(it.id)}</guid>`,
        ...(it.excerpt ? [`      <description>${xmlEscape(it.excerpt)}</description>`] : []),
        ...(pub ? [`      <pubDate>${xmlEscape(pub)}</pubDate>`] : []),
        '    </item>',
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${xmlEscape(opts.siteName)}</title>`,
    `    <link>${xmlEscape(opts.baseUrl || '/')}</link>`,
    `    <description>${xmlEscape(opts.siteDescription)}</description>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/** sitemap.xml — absolute locs, `lastmod` from updatedAt. */
export function sitemapXml(urls: readonly { readonly loc: string; readonly lastmod?: string }[]): string {
  const entries = urls
    .map((u) =>
      [
        '  <url>',
        `    <loc>${xmlEscape(u.loc)}</loc>`,
        ...(u.lastmod ? [`    <lastmod>${xmlEscape(u.lastmod)}</lastmod>`] : []),
        '  </url>',
      ].join('\n'),
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}

/** robots.txt — protected surfaces disallowed; share links (/s/) are unlisted
 *  by design (capability URLs must not be crawled). */
export function robotsTxt(baseUrl: string): string {
  return [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api',
    'Disallow: /mcp',
    'Disallow: /auth',
    'Disallow: /s/',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n');
}
