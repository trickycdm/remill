import { jsxRenderer } from 'hono/jsx-renderer';
import { ViteClient, Link, Script } from 'vite-ssr-components/hono';
import { THEME_INIT_SNIPPET } from '@/components/layouts/admin-shell';

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
export const RootLayout = jsxRenderer(({ children }) => {
  return (
    <html lang="en">
      <head>
        <title>remill</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="remill — a lightweight, agent-native CMS" />

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
});
