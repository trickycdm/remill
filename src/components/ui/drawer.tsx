/**
 * Drawer — a side panel built on the native <dialog> element (focus trap + Escape
 * + backdrop for free, same as Dialog). Used for the record editor, filters, and
 * detail views that shouldn't lose the list behind them. Shares its structure and
 * aria wiring with Dialog via ModalShell (TD-7); only the panel geometry and slide
 * side differ.
 *
 * ── Wiring (route owner) ─────────────────────────────────────────────────────
 *   <Button data-on:click="document.getElementById('edit-drawer').showModal()">Edit</Button>
 * `showModal()` enables the focus trap. Closing (✕, Escape, backdrop click,
 * footer buttons) is built in via `.close()`; focus returns to the trigger.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { ModalShell } from '@/components/ui/modal';

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
}): JSX.Element {
  const sideClass =
    side === 'right'
      ? 'right-0 left-auto rm-anim-slide-right border-l'
      : 'left-0 right-auto rm-anim-slide-left border-r';
  return (
    <ModalShell
      id={id}
      title={title}
      footer={footer}
      description={description}
      closeLabel="Close panel"
      class={cls}
      classes={{
        panel: `fixed inset-y-0 top-0 bottom-0 m-0 h-dvh max-h-dvh w-[calc(100vw-3rem)] max-w-md border-border bg-surface-raised p-0 text-ink shadow-lg ${sideClass}`,
        body: 'flex h-full flex-col',
        header: 'flex items-start justify-between gap-4 border-b border-border px-5 py-4',
        title: 'font-serif text-lg leading-snug font-semibold tracking-tight text-ink',
        desc: 'text-sm text-ink-muted',
        close:
          '-mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        content: 'flex-1 overflow-y-auto px-5 py-5',
        footer: 'flex items-center justify-end gap-2 border-t border-border px-5 py-4',
      }}
    >
      {children}
    </ModalShell>
  );
}
