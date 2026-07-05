/**
 * FieldShell — the shared edit-widget scaffolding for every field type (TD-1).
 *
 * Before this module, all 10 field modules copy-pasted the same `FormField`
 * wrapper (label ← `field.label ?? field.key`, `required`, help/placeholder from
 * `field.admin`) and the same control wiring (`id`/`name`/`data-bind`={signal},
 * `required`). Drift crept in — `media`/`slug` hard-coded help/placeholder and
 * ignored `field.admin`. Everything shared now lives here:
 *
 *   • `FieldShell`      — the accessible `FormField` wrapper (label + help slot).
 *   • `controlProps`    — the invariant control attributes to spread on the input.
 *   • `requiredNonEmpty`— the string "required ⇒ non-empty; optional ⇒ omittable"
 *                         rule, previously re-derived three different ways.
 *
 * `value` stays per-module on purpose: its shape genuinely differs by type
 * (string, `string[]` joined, ISO→datetime-local, `JSON.stringify`, checkbox
 * `checked`), so a single generic value prop would obscure more than it shares.
 */

import type { ZodString, ZodType } from 'zod';
import { FormField } from '@/components/ui';
import type { FieldDescriptor, FieldEditProps } from '@/fields/types';

/**
 * The accessible wrapper every edit widget renders into: a visible `<label>`
 * (from `field.label ?? field.key`), the required marker, and a help/description
 * slot. `help` is the field type's *default* help text — the descriptor's
 * `field.admin.help` overrides it, so admins can always customise.
 */
export function FieldShell({
  field,
  signal,
  help,
  children,
}: {
  field: FieldDescriptor;
  signal: string;
  /** Per-field-type default help; overridden by `field.admin?.help`. */
  help?: string;
  children: unknown;
}) {
  return (
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description={field.admin?.help ?? help}
    >
      {children}
    </FormField>
  );
}

/** The control attributes shared across text-like widgets. Spread onto the
 *  control, then add type-specific bits (`type`, `value`, `min`, `pattern`, …).
 *  `placeholder` sources `field.admin?.placeholder` first, then the field type's
 *  default (`opts.placeholder`). `required` defaults to `field.required` but can
 *  be forced off (`opts.required: false`) for widgets that are intentionally
 *  lenient in the browser (e.g. `slug`, which is derivable; `media`). */
export function controlProps(
  props: Pick<FieldEditProps, 'field' | 'signal'>,
  opts?: { placeholder?: string; required?: boolean },
): {
  id: string;
  name: string;
  required: boolean;
  placeholder: string | undefined;
  'data-bind': string;
} {
  const { field, signal } = props;
  return {
    id: signal,
    name: field.key,
    required: opts?.required ?? field.required ?? false,
    placeholder: field.admin?.placeholder ?? opts?.placeholder,
    'data-bind': signal,
  };
}

/**
 * The string field rule: a required field must be non-empty (`.min(1)`); an
 * optional one may be omitted entirely (`.optional()`). Replaces the three
 * hand-rolled variants in `text`/`slug`/`markdown`. Apply any config `min`/`max`
 * to `schema` first, then pass it here.
 */
export function requiredNonEmpty(
  schema: ZodString,
  field: FieldDescriptor,
): ZodType<string | undefined> {
  return (field.required ? schema.min(1) : schema.optional()) as ZodType<string | undefined>;
}
