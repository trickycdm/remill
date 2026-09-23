import { jsxRenderer } from 'hono/jsx-renderer';
import { ViteClient, Link, Script } from 'vite-ssr-components/hono';
import { THEME_INIT_SNIPPET } from '@/components/layouts/admin-shell';
import { serializeJsonLd } from '@/lib/seo';

/**
 * Per-page head props (D36): routes pass them as `c.render(content, head)` —
 * the second arg reaches the renderer as spread props. Routes compose the FULL
 * title string themselves (`${docTitle} — ${siteName}`); the layout does no DB
 * reads and falls back to the static branding when a prop is absent, so every
 * existing single-arg `c.render(...)` call renders exactly as before.
 *
 * `bare: true` is the deliberate "suppress every social/crawler tag" signal
 * (title + robots + author only) — used by the D51 password-protected
 * share-link page, which must show NO description/OG/Twitter/JSON-LD/
 * canonical/author before unlock. `description: undefined` (the default) just
 * means "no description" — it no longer implies `bare`; a document with no
 * text and no `siteDescription` still emits `og:title`/`og:url`/
 * `twitter:title`. `description: ''` is kept as a SECOND way to trigger the
 * same suppression as `bare` (an existing caller's signal); prefer `bare`.
 */
export interface PageHead {
  readonly title?: string;
  readonly description?: string;
  /** Suppress every social/crawler tag — og:*, twitter:*, article:*, JSON-LD,
   *  author, canonical, meta description. Only `<title>` and (when set)
   *  `noindex` still render. For pages that must show nothing until an
   *  access gate opens (the locked `/s/:token` share-link page, D51). */
  readonly bare?: boolean;
  /** Absolute canonical URL — emitted as `<link rel=canonical>`. Falls back
   *  to driving `og:url` too when `ogUrl` isn't set separately. */
  readonly canonical?: string;
  /** Absolute URL for `og:url` — the URL the reader is actually on. Defaults
   *  to `canonical` (D52: needed when a page has an `og:url` but must NOT
   *  emit a canonical link, e.g. an unlisted document's `doc_…` URL). */
  readonly ogUrl?: string;
  /** `og:title` — defaults to `title` when unset. */
  readonly ogTitle?: string;
  readonly ogType?: 'website' | 'article';
  /** Absolute image URL. */
  readonly ogImage?: string;
  readonly imageAlt?: string;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  /** `og:site_name`. */
  readonly siteName?: string;
  /** `og:locale` (language-only, e.g. "en" — see `DEFAULT_LOCALE`). */
  readonly locale?: string;
  /** `article:published_time`/`article:modified_time` — only emitted when
   *  `ogType === 'article'`. ISO 8601. */
  readonly publishedTime?: string;
  readonly modifiedTime?: string;
  /** `article:author` and `meta name=author`. */
  readonly author?: string;
  /** `article:tag`, one per entry. */
  readonly tags?: readonly string[];
  /** Rendered as one `<script type="application/ld+json">`, escaped via
   *  `serializeJsonLd` (no `</script>` breakout). */
  readonly jsonLd?: Record<string, unknown>;
  /** Feed href (usually '/rss.xml') — advertised for feed readers. */
  readonly feedUrl?: string;
  /** Emit <meta name="robots" content="noindex"> — draft/preview/unlisted/
   *  share-link renders (D49/D50/D52). */
  readonly noindex?: boolean;
}

declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, head?: PageHead): Response | Promise<Response>;
  }
}

/**
 * Root HTML document. Every route renders inside this via `c.render(<…/>)`.
 *
 * - Tailwind tokens come from `src/tailwind.css` (design system; the single
 *   styling source of truth). Body background/text color are set there in
 *   `@layer base`, so this layout stays decoupled from specific token names.
 * - Datastar v1 is vendored locally at `/vendor/datastar.js` — the sole
 *   hypermedia runtime, no runtime CDN dependency (keeps the CMS self-contained).
 * - `THEME_INIT_SNIPPET` (owned by the design system, in admin-shell) runs before
 *   first paint to apply a stored light/dark choice with no flash. When nothing is
 *   stored it sets nothing, so `color-scheme: light dark` follows the OS. Static
 *   string with no interpolated data — safe to inline.
 */
export const RootLayout = jsxRenderer(
  ({
    children,
    title,
    description,
    canonical,
    ogUrl,
    ogTitle,
    ogType,
    ogImage,
    imageAlt,
    imageWidth,
    imageHeight,
    siteName,
    locale,
    publishedTime,
    modifiedTime,
    author,
    tags,
    jsonLd,
    feedUrl,
    noindex,
    bare,
  }) => {
    const pageTitle = title ?? 'remill';
    // `bare` (or the legacy `description: ''` signal) suppresses every
    // social/crawler tag — the locked share-link page must show <title> and
    // `noindex` only, nothing else. `description: undefined` just means "no
    // description" and keeps the static branding fallback + og:*/twitter:*.
    const suppressSocial = bare === true || description === '';
    const pageDescription = suppressSocial ? undefined : (description ?? 'remill — a lightweight, agent-native CMS');
    const url = suppressSocial ? undefined : (ogUrl ?? canonical);
    const resolvedCanonical = suppressSocial ? undefined : canonical;
    const resolvedOgTitle = suppressSocial ? undefined : (ogTitle ?? title);
    const resolvedAuthor = suppressSocial ? undefined : author;
    return (
      <html lang="en">
        <head>
          <title>{pageTitle}</title>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          {pageDescription ? <meta name="description" content={pageDescription} /> : null}
          {noindex ? <meta name="robots" content="noindex" /> : null}
          {resolvedAuthor ? <meta name="author" content={resolvedAuthor} /> : null}

          {/* Open Graph + discovery links (D36, extended D52) — emitted only
            when a route set head props; admin pages stay meta-minimal.
            `bare` (or the legacy `description: ''` signal) suppresses this
            entire block — the locked share-link page shows <title> only. */}
          {!suppressSocial ? (
            <>
              {resolvedOgTitle ? <meta property="og:title" content={resolvedOgTitle} /> : null}
              {description ? <meta property="og:description" content={description} /> : null}
              {ogType ? <meta property="og:type" content={ogType} /> : null}
              {siteName ? <meta property="og:site_name" content={siteName} /> : null}
              {locale ? <meta property="og:locale" content={locale} /> : null}
              {ogImage ? <meta property="og:image" content={ogImage} /> : null}
              {ogImage && imageAlt ? <meta property="og:image:alt" content={imageAlt} /> : null}
              {ogImage && imageWidth ? (
                <meta property="og:image:width" content={String(imageWidth)} />
              ) : null}
              {ogImage && imageHeight ? (
                <meta property="og:image:height" content={String(imageHeight)} />
              ) : null}
              {url ? <meta property="og:url" content={url} /> : null}
              {resolvedCanonical ? <link rel="canonical" href={resolvedCanonical} /> : null}
              {/* `article:*` — only on article-shaped pages. */}
              {ogType === 'article' && publishedTime ? (
                <meta property="article:published_time" content={publishedTime} />
              ) : null}
              {ogType === 'article' && modifiedTime ? (
                <meta property="article:modified_time" content={modifiedTime} />
              ) : null}
              {ogType === 'article' && author ? (
                <meta property="article:author" content={author} />
              ) : null}
              {ogType === 'article' && tags
                ? tags.map((t) => <meta property="article:tag" content={t} />)
                : null}
              {/* Twitter falls back to og:* for title/description; only the
                card type (and image size hint) needs stating — on og-bearing
                pages. */}
              {ogType ? (
                <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
              ) : null}
              {resolvedOgTitle ? <meta name="twitter:title" content={resolvedOgTitle} /> : null}
              {description ? <meta name="twitter:description" content={description} /> : null}
              {ogImage ? <meta name="twitter:image" content={ogImage} /> : null}
              {ogImage && imageAlt ? <meta name="twitter:image:alt" content={imageAlt} /> : null}
              {feedUrl ? (
                <link rel="alternate" type="application/rss+xml" title={pageTitle} href={feedUrl} />
              ) : null}
              {/* JSON-LD (D52) — inert data, never executed as JS; the ONE
                inline script that's data-only. `serializeJsonLd` escapes
                `<`/`>`/`&` and U+2028/U+2029 so nothing can break out of the
                script context. */}
              {jsonLd ? (
                <script
                  type="application/ld+json"
                  dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
                />
              ) : null}
            </>
          ) : null}

          {/* The pen-nib wordmark glyph in overlap violet (dark-aware inside
            the SVG). Served from public/ — self-hosted, CSP-clean. */}
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

          {/* Browser chrome color matches the stock in each scheme. */}
          <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f1e3" />
          <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#191c30" />

          {/* The display face (Bricolage Grotesque, vendored) is on every
            page's first paint — preload it so headings never swap late. */}
          <link
            rel="preload"
            href="/fonts/bricolage-grotesque-latin-wght.woff2"
            as="font"
            type="font/woff2"
            crossorigin=""
          />

          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SNIPPET }} />

          <ViteClient />
          <Link href="/src/tailwind.css" rel="stylesheet" />
          <Script src="/src/client/init.ts" />

          {/* Datastar v1 — vendored, self-hosted. Drives all data-* reactivity,
            form posts, and SSE patches. See steering/DATASTAR_PATTERNS.md. */}
          <script type="module" src="/vendor/datastar.js"></script>
        </head>
        <body class="min-h-screen">{children}</body>
      </html>
    );
  },
);
