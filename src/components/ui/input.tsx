/**
 * Input — a single-line text control. Always pair with a <label> (use FormField
 * or pass `id` and label it yourself). `invalid` sets `aria-invalid` and the
 * danger border; link the error text via `aria-describedby` (FormField wires the
 * id convention for you).
 *
 * Datastar-ready: any `data-*` / `aria-*` attribute passes straight through, so
 * `<Input data-bind="title" />` or `<Input data-attr:disabled="$busy" />` work.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { CONTROL_H, type ControlSize } from '@/components/ui/control';
import { cx } from '@/components/ui/cx';

interface InputProps {
  id?: string;
  name?: string;
  type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel' | 'number' | 'date' | 'datetime-local' | 'time';
  value?: string | number;
  placeholder?: string;
  /** Control height; share the same `size` as an adjacent Button (default md). */
  size?: ControlSize;
  required?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  autocomplete?: string;
  autofocus?: boolean;
  invalid?: boolean;
  inputmode?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  pattern?: string;
  maxlength?: number;
  class?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  readonly [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

// `text-base sm:text-sm`: 16px on phones (below 16px, iOS Safari auto-zooms on
// focus), 14px from the `sm` breakpoint up. Shared by Input, Select, and Textarea.
export const INPUT_BASE =
  'w-full rounded-md border bg-surface px-3 text-base text-ink shadow-xs transition-colors placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';

export function Input({ invalid, size = 'md', class: cls, ...rest }: InputProps): JSX.Element {
  const stateClass = invalid
    ? 'border-danger focus-visible:outline-danger'
    : 'border-border-strong focus-visible:outline-ring';
  return (
    <input
      class={cx(INPUT_BASE, CONTROL_H[size], stateClass, cls)}
      aria-invalid={invalid ? 'true' : undefined}
      {...(rest as Record<string, unknown>)}
    />
  );
}
