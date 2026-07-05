/**
 * EmptyState — the calm "nothing here yet" surface shown when a list, search, or
 * collection has no rows. Icon + title + description + optional action (usually a
 * primary Button to create the first item). Centered, generous whitespace — an
 * empty screen should feel intentional, not broken.
 *
 * The icon is decorative; the title carries the meaning. Pass any icon element
 * from `@/components/ui/icon` (defaults to Inbox).
 */

import { Inbox } from '@/components/ui/icon';

export function EmptyState({
  title,
  description,
  icon,
  action,
  class: cls,
}: {
  title: unknown;
  description?: unknown;
  /** An icon element; defaults to <Inbox />. */
  icon?: unknown;
  /** An action element (e.g. a primary <Button href="…">). */
  action?: unknown;
  class?: string;
}) {
  return (
    <div
      class={`flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface/50 px-6 py-16 text-center${cls ? ` ${cls}` : ''}`}
    >
      <span class="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        {icon ?? <Inbox class="size-6" />}
      </span>
      <div class="flex max-w-sm flex-col gap-1.5">
        <h3 class="font-serif text-lg font-semibold tracking-tight text-ink">{title}</h3>
        {description ? <p class="text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div class="mt-1">{action}</div> : null}
    </div>
  );
}
