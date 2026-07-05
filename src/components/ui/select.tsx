/**
 * Select — a styled native <select>. Native is deliberate: it gives correct
 * keyboard behaviour, mobile pickers, and screen-reader semantics for free
 * (A11Y_STANDARDS.md — use the right element). Options are passed as children.
 *
 * A decorative chevron overlays the control; the native disclosure is hidden via
 * `appearance-none`. Any `data-*` / `aria-*` attribute passes through, so
 * `<Select data-bind="status"><option …/></Select>` binds to `$status`.
 */

import { ChevronDown } from '@/components/ui/icon';
import type { JSX } from 'hono/jsx/jsx-runtime';
import { INPUT_BASE } from '@/components/ui/input';
import { CONTROL_H, type ControlSize } from '@/components/ui/control';
import { cx } from '@/components/ui/cx';

interface SelectProps {
  children: unknown;
  id?: string;
  name?: string;
  value?: string;
  /** Control height; share the same `size` as an adjacent Button (default md).
   *  Ignored when `multiple` (a multi-select sizes to its rows). */
  size?: ControlSize;
  /** A multi-select list box. Sizes to its option rows; no chevron overlay. */
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  autofocus?: boolean;
  class?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  readonly [dataAttr: `data-${string}`]: unknown;
}

export function Select({ children, invalid, multiple, size = 'md', class: cls, ...rest }: SelectProps): JSX.Element {
  const stateClass = invalid
    ? 'border-danger focus-visible:outline-danger'
    : 'border-border-strong focus-visible:outline-ring';

  // A multi-select is a list box: it opts out of the fixed control height and the
  // single-select chevron, but keeps the shared INPUT_BASE (border/padding/focus).
  if (multiple) {
    return (
      <select
        multiple
        class={cx(INPUT_BASE, 'min-h-24 py-2 leading-relaxed', stateClass, cls)}
        aria-invalid={invalid ? 'true' : undefined}
        {...(rest as Record<string, unknown>)}
      >
        {children}
      </select>
    );
  }

  return (
    <div class={cx('relative', cls)}>
      <select
        class={cx(INPUT_BASE, CONTROL_H[size], 'appearance-none pr-9', stateClass)}
        aria-invalid={invalid ? 'true' : undefined}
        {...(rest as Record<string, unknown>)}
      >
        {children}
      </select>
      <ChevronDown class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-subtle" />
    </div>
  );
}
