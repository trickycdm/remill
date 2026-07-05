/**
 * Dialog — a modal built on the native <dialog> element, so focus-trapping,
 * Escape-to-close, and inert background come for free (A11Y_STANDARDS.md prefers
 * native <dialog> over a hand-rolled focus trap).
 *
 * ── Wiring (route owner) ─────────────────────────────────────────────────────
 * Opening is a route concern — trigger it from any control:
 *   <Button data-on:click="document.getElementById('confirm-delete').showModal()">Delete…</Button>
 * `showModal()` (not the `open` attribute) is what enables the focus trap and
 * backdrop. Closing is built in: the ✕ button, the Cancel/footer buttons, Escape,
 * and a backdrop click all call `.close()`. Return focus to the trigger is native.
 */

import { X } from '@/components/ui/icon';

type DialogSize = 'sm' | 'md' | 'lg';

const SIZE: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Dialog({
  id,
  title,
  children,
  footer,
  description,
  size = 'md',
  class: cls,
}: {
  id: string;
  title: unknown;
  children: unknown;
  footer?: unknown;
  description?: unknown;
  size?: DialogSize;
  class?: string;
}) {
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  return (
    <dialog
      id={id}
      aria-labelledby={titleId}
      aria-describedby={descId}
      class={`rm-anim-rise m-auto w-[calc(100vw-2rem)] ${SIZE[size]} rounded-xl border border-border bg-surface-raised p-0 text-ink shadow-lg backdrop:cursor-default${cls ? ` ${cls}` : ''}`}
      data-on:click="evt.target === el && el.close()"
    >
      {/* Inner wrapper stops backdrop-close clicks from bubbling out of the panel. */}
      <div class="flex max-h-[85vh] flex-col">
        <header class="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
          <div class="flex flex-col gap-1">
            <h2 id={titleId} class="font-serif text-xl leading-snug font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} class="text-sm leading-relaxed text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            class="-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            data-on:click="el.closest('dialog').close()"
          >
            <X class="size-5" />
          </button>
        </header>
        <div class="overflow-y-auto px-6 py-4 text-sm leading-relaxed text-ink-muted">{children}</div>
        {footer ? (
          <footer class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
