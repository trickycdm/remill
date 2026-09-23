/**
 * Textarea — multi-line text control. Same labelling/validation contract as
 * Input (pair with a <label>; `invalid` → aria-invalid + danger border). Any
 * `data-*` / `aria-*` attribute passes through for Datastar binding.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { INPUT_BASE } from '@/components/ui/input';
import { cx } from '@/components/ui/cx';

interface TextareaProps {
  id?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  rows?: number;
  maxlength?: number;
  invalid?: boolean;
  autofocus?: boolean;
  class?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  readonly [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function Textarea({ invalid, rows = 4, class: cls, value, ...rest }: TextareaProps): JSX.Element {
  const stateClass = invalid
    ? 'border-danger focus-visible:outline-danger'
    : 'border-border-strong focus-visible:outline-ring';
  return (
    <textarea
      rows={rows}
      class={cx(INPUT_BASE, 'min-h-24 resize-y py-2.5 leading-relaxed', stateClass, cls)}
      aria-invalid={invalid ? 'true' : undefined}
      {...(rest as Record<string, unknown>)}
    >
      {value}
    </textarea>
  );
}
