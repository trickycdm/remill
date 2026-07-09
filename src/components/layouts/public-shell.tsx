/**
 * PublicShell — the public read surface's chrome (C2): a settings-driven
 * masthead, the content main, a quiet footer. Rendered through the global
 * RootLayout (Datastar + Tailwind arrive there), and deliberately free of any
 * admin import — this is what an anonymous visitor sees.
 *
 * Accessibility mirrors the admin shell: skip link → #main-content, one <main>
 * landmark, header/footer landmarks (A11Y_STANDARDS.md).
 */

import type { SiteSettings } from '@/services/settings';
import { Wordmark } from '@/components/ui/wordmark';

export function PublicShell({ settings, children }: { settings: SiteSettings; children?: unknown }) {
  const siteName = settings.siteName?.trim() || 'remill';
  return (
    <div class="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>
      <header class="border-b border-border py-6">
        <a
          href="/"
          aria-label={`${siteName} home`}
          class="inline-flex rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {settings.logo ? (
            <img src={`/media/${settings.logo}`} alt="" class="h-8 w-auto" />
          ) : (
            <Wordmark label={siteName} />
          )}
        </a>
        {settings.siteDescription ? (
          <p class="mt-1 text-sm text-ink-muted">{settings.siteDescription}</p>
        ) : null}
      </header>
      <main id="main-content" class="flex-1 py-10">
        {children}
      </main>
      <footer class="border-t border-border py-6 text-sm text-ink-subtle">{siteName}</footer>
    </div>
  );
}

/** The public 404 body — one shape for missing, draft, and non-public documents
 *  (existence is never revealed; SECURITY_STANDARDS.md fail-closed posture). */
export function PublicNotFound() {
  return (
    <div class="py-16 text-center">
      <h1 class="font-serif text-3xl font-semibold tracking-tight text-ink">Not found</h1>
      <p class="mt-3 text-ink-muted">This page doesn't exist or isn't public.</p>
    </div>
  );
}
