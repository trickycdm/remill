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

// Links inside the dark act (the footer band): plain accent-text — the
// rm-dark-act scheme flip resolves it to the audited dark cyan in BOTH themes.
const BAND_LINK =
  'text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function MarketingShell({ children }: { children?: unknown }) {
  return (
    <div class="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>

      {/* Sticky, blur-backed nav: sections scroll under it (anchored sections
          carry scroll-mt-20 so headings never hide behind it). bg-canvas/85
          keeps the token pairing AA in both themes; blur does the rest. */}
      <header class="sticky top-0 z-40 border-b border-border bg-canvas/85 backdrop-blur-md">
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

      {/* The credibility layer, closed in the gig-poster register: rm-dark-act
          flips this subtree onto the dark scheme, so every token here resolves
          to its audited dark value in BOTH themes — the page signs off on navy
          with zero literal colours. It sits flush under the marketing #run
          band (also a dark act), forming one continuous close.
          TODO(release): add the repository + license links when the source
          goes public. */}
      <footer class="rm-dark-act bg-canvas text-ink">
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-8 border-t border-border px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
          <div class="flex flex-col gap-1.5">
            <Wordmark />
            <p class="text-xs text-ink-muted">A lightweight, agent-native CMS.</p>
            <p class="text-xs text-ink-muted">
              Live on Cloudflare Workers since July 2026. This site runs the product.
            </p>
          </div>
          <nav aria-label="Footer" class="grid grid-cols-2 gap-x-10 gap-y-3 sm:text-right">
            <a href="/api/openapi.json" class={BAND_LINK}>
              API reference
            </a>
            <a href="#connect" class={BAND_LINK}>
              MCP endpoint
            </a>
            <a href="/rss.xml" class={BAND_LINK}>
              RSS
            </a>
            <a href="/sitemap.xml" class={BAND_LINK}>
              Sitemap
            </a>
            <a href="#writing" class={BAND_LINK}>
              Writing
            </a>
            <a href="/admin" class={BAND_LINK}>
              Sign in
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
