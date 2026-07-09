/**
 * MarketingShell — the product homepage chrome. A full-bleed sibling of
 * PublicShell (which stays the narrow reading column for rendered documents):
 * sections run edge to edge so alternating background bands work, and manage
 * their own inner width (`mx-auto max-w-5xl px-6`).
 *
 * Accessibility contract mirrors the other shells (A11Y_STANDARDS.md): skip
 * link first → #main-content, exactly one <main>, header/footer landmarks.
 * The top iris hairline is the brand's one flourish (as on AuthShell).
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

      {/* A very quiet accent hairline at the top — the one flourish. */}
      <div aria-hidden="true" class="h-0.5 w-full bg-accent/70" />

      <header class="border-b border-border">
        <nav aria-label="Main" class="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <a href="/" aria-label="remill home" class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
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

      <footer class="border-t border-border">
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-col gap-1.5">
            <Wordmark />
            <p class="text-xs text-ink-subtle">A lightweight, agent-native CMS.</p>
          </div>
          <nav aria-label="Footer" class="flex items-center gap-6">
            <a href="/rss.xml" class={NAV_LINK}>
              RSS
            </a>
            <a href="/sitemap.xml" class={NAV_LINK}>
              Sitemap
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
