/**
 * Breadcrumb — the navigational trail rendered above a PageHeader title on nested
 * pages. A real `<nav aria-label="Breadcrumb">` + `<ol>`; ancestor crumbs are
 * links, the current page is a plain `<span aria-current="page">`. Chevron
 * separators are decorative (icons are aria-hidden by default). Depth-1 pages omit
 * it — a one-item trail is noise (item 1).
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { ChevronRight } from '@/components/ui/icon';

export interface Crumb {
  readonly label: string;
  /** Ancestor crumbs link; the final (current) crumb omits href. */
  readonly href?: string;
}

export function Breadcrumb({ items }: { items: readonly Crumb[] }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb">
      <ol class="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
        {items.map((crumb, i) => (
          <li class="flex items-center gap-1.5">
            {i > 0 ? <ChevronRight class="size-3.5 text-ink-subtle" /> : null}
            {crumb.href ? (
              <a href={crumb.href} class="hover:text-ink hover:underline">
                {crumb.label}
              </a>
            ) : (
              <span aria-current="page" class="font-medium text-ink">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
