import { jsxRenderer } from 'hono/jsx-renderer';
import { ViteClient, Link, Script } from 'vite-ssr-components/hono';
import { THEME_INIT_SNIPPET } from '@/components/layouts/admin-shell';

/**
 * Per-page head props (D36): routes pass them as `c.render(content, head)` —
 * the second arg reaches the renderer as spread props. Routes compose the FULL
 * title string themselves (`${docTitle} — ${siteName}`); the layout does no DB
 * reads and falls back to the static branding when a prop is absent, so every
 * existing single-arg `c.render(...)` call renders exactly as before.
 */
export interface PageHead {
  readonly title?: string;
  readonly description?: string;
  /** Absolute canonical URL — also becomes og:url. */
  readonly canonical?: string;
  readonly ogType?: 'website' | 'article';
  /** Absolute image URL. */
  readonly ogImage?: string;
  /** Feed href (usually '/rss.xml') — advertised for feed readers. */
  readonly feedUrl?: string;
  /** Emit <meta name="robots" content="noindex"> — draft/preview renders (D49). */
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
  ({ children, title, description, canonical, ogType, ogImage, feedUrl, noindex }) => {
    const pageTitle = title ?? 'remill';
    const pageDescription = description ?? 'remill — a lightweight, agent-native CMS';
    return (
      <html lang="en">
        <head>
          <title>{pageTitle}</title>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="description" content={pageDescription} />
          {noindex ? <meta name="robots" content="noindex" /> : null}

          {/* Open Graph + discovery links (D36) — emitted only when a route set
            head props; admin pages stay meta-minimal. */}
          {title ? <meta property="og:title" content={title} /> : null}
          {description ? <meta property="og:description" content={description} /> : null}
          {ogType ? <meta property="og:type" content={ogType} /> : null}
          {ogImage ? <meta property="og:image" content={ogImage} /> : null}
          {canonical ? <meta property="og:url" content={canonical} /> : null}
          {canonical ? <link rel="canonical" href={canonical} /> : null}
          {/* Twitter falls back to og:* for title/description; only the card
            type (and image size hint) needs stating — on og-bearing pages. */}
          {ogType ? (
            <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
          ) : null}
          {ogImage ? <meta name="twitter:image" content={ogImage} /> : null}
          {feedUrl ? (
            <link rel="alternate" type="application/rss+xml" title={pageTitle} href={feedUrl} />
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
