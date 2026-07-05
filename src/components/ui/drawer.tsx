/**
 * Drawer — a side panel built on the native <dialog> element (focus trap +
 * Escape + backdrop for free, same as Dialog). Used for the record editor,
 * filters, and detail views that shouldn't lose the list behind them.
 *
 * ── Wiring (route owner) ─────────────────────────────────────────────────────
 *   <Button data-on:click="document.getElementById('edit-drawer').showModal()">Edit</Button>
 * `showModal()` enables the focus trap. Closing (✕, Escape, backdrop click,
 * footer buttons) is built in via `.close()`; focus returns to the trigger.
 */

import { X } from '@/components/ui/icon';

export function Drawer({
  id,
  title,
  children,
  footer,
  description,
  side = 'right',
  class: cls,
}: {
  id: string;
  title: unknown;
  children: unknown;
  footer?: unknown;
  description?: unknown;
  side?: 'right' | 'left';
  class?: string;
}) {
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  const sideClass =
    side === 'right'
      ? 'right-0 left-auto rm-anim-slide-right border-l'
      : 'left-0 right-auto rm-anim-slide-left border-r';
  return (
    <dialog
      id={id}
      aria-labelledby={titleId}
      aria-describedby={descId}
      class={`fixed inset-y-0 top-0 bottom-0 m-0 h-dvh max-h-dvh w-[calc(100vw-3rem)] max-w-md border-border bg-surface-raised p-0 text-ink shadow-lg ${sideClass}${cls ? ` ${cls}` : ''}`}
      data-on:click="evt.target === el && el.close()"
    >
      <div class="flex h-full flex-col">
        <header class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div class="flex flex-col gap-1">
            <h2 id={titleId} class="font-serif text-lg leading-snug font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} class="text-sm text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close panel"
            class="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            data-on:click="el.closest('dialog').close()"
          >
            <X class="size-5" />
          </button>
        </header>
        <div class="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <footer class="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
