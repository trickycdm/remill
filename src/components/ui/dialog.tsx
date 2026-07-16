/**
 * Dialog — a centered modal built on the native <dialog> element (focus-trapping,
 * Escape-to-close, inert background for free — A11Y_STANDARDS.md). Shares its
 * structure and aria wiring with Drawer via ModalShell (TD-7); only the panel
 * geometry differs.
 *
 * ── Wiring (route owner) ─────────────────────────────────────────────────────
 * Opening is a route concern — trigger it from any control:
 *   <Button data-on:click="document.getElementById('confirm-delete').showModal()">Delete…</Button>
 * `showModal()` (not the `open` attribute) is what enables the focus trap and
 * backdrop. Closing is built in: the ✕ button, the Cancel/footer buttons, Escape,
 * and a backdrop click all call `.close()`. Return focus to the trigger is native.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { ModalShell } from '@/components/ui/modal';

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
}): JSX.Element {
  return (
    <ModalShell
      id={id}
      title={title}
      footer={footer}
      description={description}
      closeLabel="Close dialog"
      class={cls}
      classes={{
        panel: `rm-anim-rise m-auto w-[calc(100vw-2rem)] ${SIZE[size]} rounded-xl border border-border bg-surface-raised p-0 text-ink shadow-lg backdrop:cursor-default`,
        body: 'flex max-h-[85vh] flex-col',
        header: 'flex items-start justify-between gap-4 px-6 pt-6 pb-2',
        title: 'font-display text-xl leading-snug font-semibold tracking-tight text-ink',
        desc: 'text-sm leading-relaxed text-ink-muted',
        close:
          '-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        content: 'overflow-y-auto px-6 py-4 text-sm leading-relaxed text-ink-muted',
        footer: 'flex items-center justify-end gap-2 border-t border-border px-6 py-4',
      }}
    >
      {children}
    </ModalShell>
  );
}
