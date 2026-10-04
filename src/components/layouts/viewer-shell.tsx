/**
 * ViewerShell — the full-viewport frame around a `renderMode: 'frame'` document
 * (D60): a slim remill-owned bar (home mark, the page title, its visibility,
 * the viewer's actions) and the author's document filling everything below it
 * in a sandboxed iframe. ONE shell for the admin view, a share link and the
 * public URL — what differs per surface is only what fills the slots: the
 * `actions` in the bar, an optional `notice` strip under it, the `review`
 * panel beside the frame, and `children` for the drawers those actions open.
 *
 * The iframe is the security boundary: `sandbox` WITHOUT `allow-same-origin`
 * puts the author's scripts in an opaque origin, so nothing in the document can
 * read this shell, its cookies, or call the API as the viewer. `frameSrc` is a
 * ticketed `/frame/…` URL from `mintFrameSrc` (services/frame).
 *
 * Public-safe: no admin-shell import, no data fetching.
 */

import type { Visibility } from '@/lib/visibility';
import { cx } from '@/components/ui/cx';
import { Wordmark } from '@/components/ui/wordmark';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { ToastHost } from '@/components/ui/toast';
import { VisibilityStamp } from '@/components/admin/visibility-stamp';
import { FRAME_SANDBOX } from '@/lib/frame/policy';

export function ViewerShell({
  title,
  frameSrc,
  home,
  visibility,
  actions,
  notice,
  review,
  children,
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
  /** A status strip between the bar and the document (e.g. "an old version"). */
  notice?: unknown;
  /** Review mode (D55 on a framed page): the server-rendered review panel,
   *  laid out beside the frame, and the page field the frame's text belongs
   *  to. The caller also renders the review island's `<Script>`. */
  review?: { readonly panel: unknown; readonly field: string };
  /** Drawers and dialogs the actions open. */
  children?: unknown;
}) {
  return (
    <div class="flex h-dvh flex-col bg-canvas">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>
      {/* Wraps below `sm`: title on the first row, actions on the second. */}
      <header class="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5">
        <a
          href={home.href}
          aria-label={home.label}
          class="inline-flex shrink-0 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Wordmark label="" class="gap-0" />
        </a>
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <h1 class="min-w-0 truncate text-sm font-medium text-ink">{title}</h1>
          <VisibilityStamp visibility={visibility} />
        </div>
        <div class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
          {actions}
          <ThemeToggle />
        </div>
      </header>
      {notice}
      {/* Reviewing: the panel is a column beside the frame on wide screens and
          a strip under it on narrow ones — never an overlay on the document. */}
      <main id="main-content" class={cx('flex min-h-0 flex-1 flex-col lg:flex-row', review && 'rm-viewer-review')}>
        <iframe
          src={frameSrc}
          title={title}
          sandbox={FRAME_SANDBOX}
          referrerpolicy="no-referrer"
          // The review island finds the frame by this marker and learns which
          // field its text is (src/client/review.ts).
          data-rm-frame={review ? '' : undefined}
          data-rm-field={review?.field}
          // White, not a theme token: this is the DOCUMENT's canvas, and a page
          // that sets no background expects the browser default in both themes.
          class="block min-h-0 w-full flex-1 border-0 bg-white"
        />
        {review?.panel}
      </main>
      {children}
      {/* Surfaces `dsError` toasts from the drawers' Datastar posts. */}
      <ToastHost />
    </div>
  );
}
