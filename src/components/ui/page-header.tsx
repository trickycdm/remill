/**
 * PageHeader — the editorial masthead of a content region: a mono-caps eyebrow,
 * a serif display <h1>, an optional lede, and a right-aligned actions slot.
 *
 * Renders the page's single <h1> by default (A11Y_STANDARDS.md — one h1 per
 * page). Pass `as="h2"` when a header is used inside a section that already owns
 * the h1. The eyebrow is decorative-adjacent context, not a heading level.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';
import { Breadcrumb, type Crumb } from '@/components/ui/breadcrumb';

export function PageHeader({
  title,
  eyebrow,
  breadcrumb,
  description,
  actions,
  as: As = 'h1',
  class: cls,
}: {
  title: unknown;
  eyebrow?: unknown;
  /** Navigational trail shown above the title on nested pages (omit at depth 1). */
  breadcrumb?: readonly Crumb[];
  description?: unknown;
  actions?: unknown;
  as?: 'h1' | 'h2';
  class?: string;
}): JSX.Element {
  return (
    // `mb-8` owns the space below the hairline so page content never butts against
    // it — previously each page compensated with an ad-hoc `mt-8` (item 6).
    <header class={cx('mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between', cls)}>
      <div class="flex flex-col gap-2">
        {breadcrumb && breadcrumb.length ? <Breadcrumb items={breadcrumb} /> : null}
        {eyebrow ? (
          <span class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
            {eyebrow}
          </span>
        ) : null}
        <As class="font-display text-display-sm font-semibold tracking-tight text-ink sm:text-display">
          {title}
        </As>
        {description ? (
          <p class="max-w-2xl text-[15px] leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div class="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
