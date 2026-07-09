/**
 * Wordmark — the remill logotype: a serif name with an iris-ink nib accent.
 * Public-safe (imports only the icon primitive), so the auth shell and the
 * public masthead can share it. `label` defaults to the product name; the
 * public masthead passes the instance's own site name so a deployment brands
 * itself while keeping the remill treatment.
 */

import { PenNib } from '@/components/ui/icon';

export function Wordmark({ label = 'remill', class: cls }: { label?: string; class?: string }) {
  return (
    <span
      class={`inline-flex items-center gap-2 font-serif text-2xl font-semibold tracking-tight text-ink${cls ? ` ${cls}` : ''}`}
    >
      <PenNib class="size-5 text-accent-text" />
      {label}
    </span>
  );
}
