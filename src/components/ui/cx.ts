/**
 * cx — join class names, dropping falsy entries (`false`/`null`/`undefined`/`''`).
 * The owned, dependency-free stand-in for `clsx`: no Tailwind-merge magic, just
 * predictable conditional concatenation, later values last. Replaces the repeated
 * `${cls ? ` ${cls}` : ''}` inline merges across the UI primitives (TD-7).
 *
 *   cx(BASE, VARIANT[variant], invalid && 'border-danger', cls)
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
