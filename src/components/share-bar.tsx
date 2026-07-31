/**
 * ShareBar — the reader-facing share affordance for the article template. This
 * is NOT the admin grant-based share panel (that grants a principal access); it
 * just helps a reader pass along a public URL. Styled as the article's tear-off
 * colophon: a perforated `rm-perf` rule ("tear here, pass it on"), the same mono
 * eyebrow as the Details zone, and design-system buttons. Server-rendered so it
 * works with NO JavaScript (the social links are plain navigations); the
 * src/client/share.ts island then reveals a "Copy link" / native "Share…" group
 * and retires the fallbacks. The transient "Copied" confirmation is the page's
 * one pop-ink moment (something happened — the pop rule's territory).
 * CSP-clean — no external requests, only anchor navigations.
 */

import { Button } from '@/components/ui/button';
import { LinkIcon, ShareIcon } from '@/components/ui/icon';

export function ShareBar({ url, title }: { url: string; title: string }) {
  const enc = encodeURIComponent;
  const linkClass =
    'text-sm text-accent-text underline decoration-1 underline-offset-4 hover:decoration-2';
  return (
    <section
      aria-label="Share"
      data-share
      class="rm-perf rm-measure mt-2 flex flex-wrap items-center gap-x-4 gap-y-3 pt-6"
    >
      <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
        Share
      </span>

      {/* Enhanced controls — hidden until the island mounts (useless without JS). */}
      <div data-share-js class="hidden flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" data-share-copy data-share-url={url}>
          <LinkIcon class="size-3.5" />
          Copy link
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-share-native
          data-share-url={url}
          data-share-title={title}
        >
          <ShareIcon class="size-3.5" />
          Share…
        </Button>
        <span data-share-status role="status" aria-live="polite" class="text-sm text-pop-text"></span>
      </div>

      {/* No-JS fallbacks: real navigations to the platforms' share intents. */}
      <div data-share-fallback class="flex flex-wrap items-center gap-4">
        <a
          href={`https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}`}
          target="_blank"
          rel="noopener"
          class={linkClass}
        >
          X
        </a>
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`}
          target="_blank"
          rel="noopener"
          class={linkClass}
        >
          LinkedIn
        </a>
        <a href={`mailto:?subject=${enc(title)}&body=${enc(url)}`} class={linkClass}>
          Email
        </a>
      </div>
    </section>
  );
}
