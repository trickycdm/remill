/**
 * ModalShell — the shared scaffolding behind Dialog and Drawer (TD-7). Both are
 * built on the native <dialog> element (focus trap + Escape + inert background for
 * free — A11Y_STANDARDS.md prefers native <dialog> over a hand-rolled focus trap),
 * and both render the same structure: a labelled panel with a header (title +
 * optional description + close button), a scrollable content region, and an
 * optional footer. Only the cosmetic class strings and the close-button label
 * differ, so that structure — and its aria wiring — lives here ONCE. Dialog and
 * Drawer are thin wrappers that supply the `classes` and `closeLabel`.
 *
 * Closing is built in: the ✕ button, Escape, and a backdrop click all call
 * `.close()`; the caller opens it with `.showModal()` (which is what enables the
 * focus trap). Return focus to the trigger is native.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { X } from '@/components/ui/icon';
import { cx } from '@/components/ui/cx';

/** The per-variant class slots Dialog/Drawer fill in. */
export interface ModalClasses {
  panel: string;
  body: string;
  header: string;
  title: string;
  desc: string;
  close: string;
  content: string;
  footer: string;
}

export function ModalShell({
  id,
  title,
  children,
  footer,
  description,
  closeLabel,
  classes,
  class: cls,
}: {
  id: string;
  title: unknown;
  children: unknown;
  footer?: unknown;
  description?: unknown;
  /** Accessible name for the close button (e.g. "Close dialog" / "Close panel"). */
  closeLabel: string;
  classes: ModalClasses;
  class?: string;
}): JSX.Element {
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  return (
    <dialog
      id={id}
      aria-labelledby={titleId}
      aria-describedby={descId}
      class={cx(classes.panel, cls)}
      data-on:click="evt.target === el && el.close()"
    >
      {/* Inner wrapper stops backdrop-close clicks from bubbling out of the panel. */}
      <div class={classes.body}>
        <header class={classes.header}>
          <div class="flex flex-col gap-1">
            <h2 id={titleId} class={classes.title}>
              {title}
            </h2>
            {description ? (
              <p id={descId} class={classes.desc}>
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" aria-label={closeLabel} class={classes.close} data-on:click="el.closest('dialog').close()">
            <X class="size-5" />
          </button>
        </header>
        <div class={classes.content}>{children}</div>
        {footer ? <footer class={classes.footer}>{footer}</footer> : null}
      </div>
    </dialog>
  );
}
