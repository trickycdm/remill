/**
 * Toggle — a switch for a single on/off state (boolean fields, workflow/access
 * flags, boolean settings). It is a native `<input type="checkbox" role="switch">`
 * restyled as a track + thumb: it POSTs like a checkbox, toggles with Space, binds
 * under Datastar (`data-bind`), and announces as a switch to assistive tech —
 * progressive enhancement, no JS of its own (item 5).
 *
 * No internal `<label>`: give it `id={signal}` and let FieldShell / FormField's
 * `<label for>` name it (same wiring as Checkbox). Any `data-*` / `aria-*` passes
 * straight through.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';

interface ToggleProps {
  id?: string;
  name?: string;
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
  value?: string;
  class?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  readonly [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function Toggle({ class: cls, ...rest }: ToggleProps): JSX.Element {
  return (
    <span class={cx('relative inline-flex h-6 w-11 shrink-0', cls)}>
      {/* The real control: transparent, on top, drives the peer styles below. */}
      <input
        type="checkbox"
        role="switch"
        class="peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
        {...(rest as Record<string, unknown>)}
      />
      {/* Track: neutral off, working ink on. */}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 rounded-full bg-border-strong transition-colors peer-checked:bg-accent peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
      />
      {/* Thumb: slides 20px right when checked (respects reduced-motion globally). */}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute top-0.5 left-0.5 size-5 rounded-full bg-surface-raised shadow-sm transition-transform peer-checked:translate-x-5"
      />
    </span>
  );
}
