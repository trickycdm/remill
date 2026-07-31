/**
 * Wordmark — the remill logotype: a display-face name with the pen-nib mark
 * in overlap violet (the two brand inks multiplied; below 24px the mark is
 * always single-ink — DESIGN_SYSTEM.md, Overprint). Public-safe (imports only
 * the icon primitive), so the auth shell and the public masthead can share
 * it. `label` defaults to the product name; the public masthead passes the
 * instance's own site name so a deployment brands itself while keeping the
 * remill treatment.
 */

import { PenNib } from '@/components/ui/icon';

export function Wordmark({ label = 'remill', class: cls }: { label?: string; class?: string }) {
  return (
    <span
      class={`inline-flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink${cls ? ` ${cls}` : ''}`}
    >
      {/* -ml-px: optical correction — the nib glyph's ink starts ~1.3/24 units
          into its viewBox (~1.1px at size-5), so without it the mark reads
          right of a flush-left text column below. */}
      <PenNib class="-ml-px size-5 text-overlap" />
      {label}
    </span>
  );
}
