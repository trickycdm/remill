/**
 * ViewerShell — the full-viewport frame around a `renderMode: 'frame'` document
 * (D60): a slim remill-owned bar (home mark, the page title, its visibility,
 * the viewer's actions) and the author's document filling everything below it
 * in a sandboxed iframe. ONE shell for the admin view, a share link and the
 * public URL — what differs per surface is only the `actions` slot.
 *
 * The iframe is the security boundary: `sandbox` WITHOUT `allow-same-origin`
 * puts the author's scripts in an opaque origin, so nothing in the document can
 * read this shell, its cookies, or call the API as the viewer. `frameSrc` is a
 * ticketed `/frame/…` URL from `mintFrameSrc` (services/frame).
 *
 * Public-safe: no admin-shell import, no data fetching.
 */

import type { Visibility } from '@/lib/visibility';
import { Wordmark } from '@/components/ui/wordmark';
import { VisibilityStamp } from '@/components/admin/visibility-stamp';
import { FRAME_SANDBOX } from '@/lib/frame/policy';

export function ViewerShell({
  title,
  frameSrc,
  home,
  visibility,
  actions,
}: {
  title: string;
  /** The ticketed content URL the iframe loads. */
  frameSrc: string;
  /** Where the mark links: the admin for a signed-in owner, the site otherwise. */
  home: { readonly href: string; readonly label: string };
  /** Stamped beside the title when the page is not public (omit for viewers
   *  who should not learn it, e.g. a share-link reader). */
  visibility?: Visibility;
  actions?: unknown;
}) {
  return (
    <div class="flex h-dvh flex-col bg-canvas">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>
      <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <a
          href={home.href}
          aria-label={home.label}
          class="inline-flex shrink-0 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Wordmark label="" class="gap-0" />
        </a>
        <h1 class="min-w-0 truncate text-sm font-medium text-ink">{title}</h1>
        <VisibilityStamp visibility={visibility} />
        {actions ? <div class="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <main id="main-content" class="min-h-0 flex-1">
        <iframe
          src={frameSrc}
          title={title}
          sandbox={FRAME_SANDBOX}
          referrerpolicy="no-referrer"
          // White, not a theme token: this is the DOCUMENT's canvas, and a page
          // that sets no background expects the browser default in both themes.
          class="block size-full border-0 bg-white"
        />
      </main>
    </div>
  );
}
