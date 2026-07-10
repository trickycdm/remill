/**
 * MarketingShell — the product homepage chrome. A full-bleed sibling of
 * PublicShell (which stays the narrow reading column for rendered documents):
 * sections run edge to edge so alternating background bands work, and manage
 * their own inner width (`mx-auto max-w-5xl px-6`).
 *
 * Accessibility contract mirrors the other shells (A11Y_STANDARDS.md): skip
 * link first → #main-content, exactly one <main>, header/footer landmarks.
 * The iris accent statement is the hero band itself (MarketingHero), so the
 * shell chrome stays quiet — no top hairline competing with it.
 */

import { Wordmark } from '@/components/auth-shell';

const NAV_LINK =
  'text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function MarketingShell({ children }: { children?: unknown }) {
  return (
    <div class="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>

      <header class="border-b border-border">
        <nav
          aria-label="Main"
          class="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6"
        >
          <a
            href="/"
            aria-label="remill home"
            class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Wordmark />
          </a>
          <div class="flex items-center gap-6">
            <a href="#writing" class={NAV_LINK}>
              Writing
            </a>
            <a href="/admin" class={NAV_LINK}>
              Sign in
            </a>
          </div>
        </nav>
      </header>

      <main id="main-content" class="flex-1">
        {children}
      </main>

      {/* The credibility layer (was one line deep, which read as abandoned).
          TODO(release): add the repository + license links when the source
          goes public. */}
      <footer class="border-t border-border">
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div class="flex flex-col gap-1.5">
            <Wordmark />
            <p class="text-xs text-ink-subtle">A lightweight, agent-native CMS.</p>
            <p class="text-xs text-ink-subtle">
              Live on Cloudflare Workers since July 2026. This site runs the product.
            </p>
          </div>
          <nav aria-label="Footer" class="grid grid-cols-2 gap-x-10 gap-y-3 sm:text-right">
            <a href="/api/openapi.json" class={NAV_LINK}>
              API reference
            </a>
            <a href="#connect" class={NAV_LINK}>
              MCP endpoint
            </a>
            <a href="/rss.xml" class={NAV_LINK}>
              RSS
            </a>
            <a href="/sitemap.xml" class={NAV_LINK}>
              Sitemap
            </a>
            <a href="#writing" class={NAV_LINK}>
              Writing
            </a>
            <a href="/admin" class={NAV_LINK}>
              Sign in
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
