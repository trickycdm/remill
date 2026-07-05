/**
 * AuthShell — the editorial "title page" shell for unauthenticated routes
 * (/admin/login). A calm centered composition on warm paper: the remill wordmark
 * over a hairline rule, a mono colophon line, and a single card holding the form.
 * Works in light and dark from day one (all tokens carry both values).
 *
 * Presentational only — pass the login form (Datastar-wired by the route) as
 * children. Renders the page's <main> landmark and a skip link for consistency
 * with the admin shell.
 */

import { PenNib } from '@/components/ui/icon';

/** The remill wordmark: a serif logotype with an iris-ink nib accent. */
export function Wordmark({ class: cls }: { class?: string }) {
  return (
    <span class={`inline-flex items-center gap-2 font-serif text-2xl font-semibold tracking-tight text-ink${cls ? ` ${cls}` : ''}`}>
      <PenNib class="size-5 text-accent-text" />
      remill
    </span>
  );
}

export function AuthShell({ children }: { children: unknown }) {
  return (
    <div class="relative flex min-h-dvh flex-col bg-canvas">
      <a
        href="#main-content"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>

      {/* A very quiet accent hairline at the top — the one flourish. */}
      <div aria-hidden="true" class="h-0.5 w-full bg-accent/70" />

      <main id="main-content" class="flex flex-1 items-center justify-center px-4 py-12">
        <div class="rm-anim-rise flex w-full max-w-md flex-col items-center gap-8">
          <div class="flex flex-col items-center gap-3 text-center">
            <a href="/admin" aria-label="remill home">
              <Wordmark class="text-3xl" />
            </a>
            <div class="flex items-center gap-3">
              <span aria-hidden="true" class="h-px w-8 bg-border-strong" />
              <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
                Content, milled
              </span>
              <span aria-hidden="true" class="h-px w-8 bg-border-strong" />
            </div>
          </div>

          <div class="w-full rounded-xl border border-border bg-surface p-8 shadow-sm">{children}</div>

          <p class="text-xs text-ink-subtle">A lightweight, agent-native CMS.</p>
        </div>
      </main>
    </div>
  );
}
