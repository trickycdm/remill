/**
 * Checkbox — a native <input type="checkbox"> styled to the token palette. Native
 * is deliberate: correct keyboard behaviour and screen-reader semantics for free
 * (A11Y_STANDARDS.md — use the right element). Always give it an accessible name,
 * either by wrapping it in a <label> or via `aria-label`.
 *
 * Any `data-*` / `aria-*` attribute passes straight through, so
 * `<Checkbox data-attr:disabled="$busy" />` binds under Datastar. Replaces the
 * checkbox class string that was hand-duplicated in the collection builder (TD-7).
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';

interface CheckboxProps {
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

const CHECKBOX_BASE =
  'size-4 rounded border-border-strong text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function Checkbox({ class: cls, ...rest }: CheckboxProps): JSX.Element {
  return <input type="checkbox" class={cx(CHECKBOX_BASE, cls)} {...(rest as Record<string, unknown>)} />;
}
