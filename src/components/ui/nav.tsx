/**
 * Nav — the sidebar navigation list. Renders a real <nav> landmark with a <ul>
 * of links; the active item is marked with `aria-current="page"` and a visible
 * ink indicator (colour is never the only active signal — A11Y_STANDARDS.md).
 *
 * Presentational: the shell owns the item list (labels, hrefs, icons) and the
 * `current` key. Icons are optional icon components from `@/components/ui/icon`.
 */

import type { IconComponent } from '@/components/ui/icon';

export interface NavItem {
  /** Stable key matched against `current` to mark the active item. */
  key: string;
  label: string;
  href: string;
  icon?: IconComponent;
}

export function Nav({
  items,
  current,
  ariaLabel = 'Primary',
  class: cls,
}: {
  items: readonly NavItem[];
  current: string;
  ariaLabel?: string;
  class?: string;
}) {
  return (
    <nav aria-label={ariaLabel} class={cls}>
      <ul class="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = item.key === current;
          const Icon = item.icon;
          return (
            <li>
              <a
                href={item.href}
                aria-current={active ? 'page' : undefined}
                class={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  active
                    ? 'bg-accent-soft font-medium text-accent-text'
                    : 'text-ink-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {/* Active indicator — a second, non-colour signal. */}
                <span
                  aria-hidden="true"
                  class={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent-text transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
                />
                {Icon ? (
                  <Icon class={`size-[18px] shrink-0 ${active ? 'text-accent-text' : 'text-ink-subtle group-hover:text-ink'}`} />
                ) : null}
                <span class="truncate">{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
