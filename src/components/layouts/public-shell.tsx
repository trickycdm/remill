/**
 * PublicShell — the public read surface's chrome (C2): a settings-driven
 * masthead, the content main, a quiet footer. Rendered through the global
 * RootLayout (Datastar + Tailwind arrive there), and deliberately free of any
 * admin import — this is what an anonymous visitor sees.
 *
 * Accessibility mirrors the admin shell: skip link → #main-content, one <main>
 * landmark, header/footer landmarks (A11Y_STANDARDS.md).
 *
 * `indexLink` (optional) is the masthead's wayfinding affordance — "More
 * <collection>" on document pages, pointing at the public collection index.
 * Callers pass it only when that index actually resolves (publicRead); the
 * share-link route never passes it (a private link advertises nothing).
 *
 * `preview` (optional, D49) renders the author-facing preview banner above the
 * masthead — only the public route sets it, and only for a session-principal
 * `?preview=1` render. An `/admin/...` href is wayfinding, not an admin import.
 */

import type { SiteSettings } from '@/services/settings';
import { Wordmark } from '@/components/ui/wordmark';

const FOOTER_LINK =
  'rounded-sm hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function PublicShell({
  settings,
  indexLink,
  preview,
  children,
}: {
  settings: SiteSettings;
  indexLink?: { readonly href: string; readonly label: string };
  preview?: { readonly editHref: string; readonly status: 'draft' | 'published' };
  children?: unknown;
}) {
  const siteName = settings.siteName?.trim() || 'remill';
  return (
    <div class="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>
      {preview ? (
        <div class="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md bg-accent px-4 py-2 text-sm text-accent-fg">
          <span>
            {preview.status === 'draft'
              ? 'Draft preview — this page is not publicly visible.'
              : 'Preview — this is the live published page.'}
          </span>
          <a
            href={preview.editHref}
            class="rounded-sm font-medium underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Back to editor
          </a>
        </div>
      ) : null}
      <header class="border-b border-border py-6">
        <div class="flex items-center justify-between gap-4">
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
          {indexLink ? (
            <a href={indexLink.href} class={`text-sm font-medium text-ink-muted ${FOOTER_LINK}`}>
              {indexLink.label}
            </a>
          ) : null}
        </div>
        {settings.siteDescription ? (
          <p class="mt-1 text-sm text-ink-muted">{settings.siteDescription}</p>
        ) : null}
      </header>
      <main id="main-content" class="flex-1 py-10">
        {children}
      </main>
      <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-border py-6 text-sm text-ink-subtle">
        <span>{siteName}</span>
        <nav aria-label="Site feeds">
          <ul class="flex items-center gap-4">
            <li>
              <a href="/rss.xml" class={FOOTER_LINK}>
                RSS
              </a>
            </li>
            <li>
              <a href="/sitemap.xml" class={FOOTER_LINK}>
                Sitemap
              </a>
            </li>
          </ul>
        </nav>
      </footer>
    </div>
  );
}

/** The public 404 body — one shape for missing, draft, and non-public documents
 *  (existence is never revealed; SECURITY_STANDARDS.md fail-closed posture). */
export function PublicNotFound() {
  return (
    <div class="py-16 text-center">
      <h1 class="font-display text-3xl font-semibold tracking-tight text-ink">Not found</h1>
      <p class="mt-3 text-ink-muted">This page doesn't exist or isn't public.</p>
    </div>
  );
}
