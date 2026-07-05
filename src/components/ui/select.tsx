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
import { INPUT_BASE } from '@/components/ui/input';

interface SelectProps {
  children: unknown;
  id?: string;
  name?: string;
  value?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  autofocus?: boolean;
  class?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  readonly [dataAttr: `data-${string}`]: unknown;
}

export function Select({ children, invalid, class: cls, ...rest }: SelectProps) {
  const stateClass = invalid
    ? 'border-danger focus-visible:outline-danger'
    : 'border-border-strong focus-visible:outline-ring';
  return (
    <div class={`relative${cls ? ` ${cls}` : ''}`}>
      <select
        class={`${INPUT_BASE} h-10 appearance-none pr-9 ${stateClass}`}
        aria-invalid={invalid ? 'true' : undefined}
        {...(rest as Record<string, unknown>)}
      >
        {children}
      </select>
      <ChevronDown class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-subtle" />
    </div>
  );
}
