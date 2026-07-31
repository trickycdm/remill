/**
 * FormField — the labelled-by-construction wrapper every form control lives in:
 * a visible <label>, the control (children), optional help text, and a
 * live-region error slot. This is how the generated edit view (SCHEMA_ENGINE)
 * gets accessible forms for free — field EditComponents render into a FormField.
 *
 * Id convention (wire these on the control you pass as children):
 *   • control        id={fieldId}
 *   • help text      id={`${fieldId}-desc`}
 *   • error text     id={`${fieldId}-error`}   (role="alert", aria-live)
 *   • control links  aria-describedby={describedBy(fieldId, { description, error })}
 *   • control marks  invalid={!!error}
 *
 * The error slot is ALWAYS rendered (empty when clean) so a Datastar patch that
 * morphs an inline validation message into `#${fieldId}-error` is announced —
 * live regions must exist in the first render (A11Y_STANDARDS.md §Live regions).
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';

/** Build the aria-describedby value for a control inside a FormField. */
export function describedBy(
  fieldId: string,
  opts: { description?: boolean; error?: boolean },
): string | undefined {
  const ids: string[] = [];
  if (opts.description) ids.push(`${fieldId}-desc`);
  if (opts.error) ids.push(`${fieldId}-error`);
  return ids.length ? ids.join(' ') : undefined;
}

export function Label({
  children,
  for: htmlFor,
  required = false,
  class: cls,
}: {
  children: unknown;
  for: string;
  required?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <label for={htmlFor} class={cx('flex items-center gap-1.5 text-sm font-medium text-ink', cls)}>
      {children}
      {required ? (
        <span class="text-danger" title="Required">
          <span aria-hidden="true">*</span>
          <span class="sr-only">(required)</span>
        </span>
      ) : null}
    </label>
  );
}

export function FormField({
  fieldId,
  label,
  children,
  description,
  error,
  required = false,
  class: cls,
}: {
  fieldId: string;
  label: unknown;
  children: unknown;
  description?: unknown;
  error?: unknown;
  required?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <div class={cx('flex flex-col gap-1.5', cls)}>
      <Label for={fieldId} required={required}>
        {label}
      </Label>
      {description ? (
        <p id={`${fieldId}-desc`} class="text-[13px] leading-normal text-ink-muted">
          {description}
        </p>
      ) : null}
      {children}
      {/* Live region — present even when clean so morphed errors announce. */}
      <p
        id={`${fieldId}-error`}
        role="alert"
        aria-live="assertive"
        class={cx('text-[13px] font-medium text-danger', !error && 'hidden')}
      >
        {error}
      </p>
    </div>
  );
}
