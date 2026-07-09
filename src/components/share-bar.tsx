/**
 * ShareBar — the reader-facing share affordance for the article template. This
 * is NOT the admin grant-based share panel (that grants a principal access); it
 * just helps a reader pass along a public URL. Server-rendered so it works with
 * NO JavaScript (the social links are plain navigations); the src/client/share.ts
 * island then reveals a "Copy link" / native "Share…" group and retires the
 * fallbacks. CSP-clean — no external requests, only anchor navigations.
 */

export function ShareBar({ url, title }: { url: string; title: string }) {
  const enc = encodeURIComponent;
  const linkClass = 'text-sm text-accent-text hover:underline';
  const btnClass = 'rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface';
  return (
    <section aria-label="Share" data-share class="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-6">
      <span class="text-sm font-medium text-ink-muted">Share</span>

      {/* Enhanced controls — hidden until the island mounts (useless without JS). */}
      <div data-share-js class="hidden flex-wrap items-center gap-2">
        <button type="button" data-share-copy data-share-url={url} class={btnClass}>
          Copy link
        </button>
        <button type="button" data-share-native data-share-url={url} data-share-title={title} class={btnClass}>
          Share…
        </button>
        <span data-share-status role="status" aria-live="polite" class="text-sm text-ink-subtle"></span>
      </div>

      {/* No-JS fallbacks: real navigations to the platforms' share intents. */}
      <div data-share-fallback class="flex flex-wrap items-center gap-3">
        <a href={`https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}`} target="_blank" rel="noopener" class={linkClass}>
          X
        </a>
        <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`} target="_blank" rel="noopener" class={linkClass}>
          LinkedIn
        </a>
        <a href={`mailto:?subject=${enc(title)}&body=${enc(url)}`} class={linkClass}>
          Email
        </a>
      </div>
    </section>
  );
}
