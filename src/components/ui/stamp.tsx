/**
 * Stamp — a rubber-stamp state marker (the Overprint brand's icon-for-a-state,
 * DESIGN_SYSTEM.md). Colour NEVER carries meaning alone: the label text is the
 * signal (A11Y_STANDARDS.md §Colour). Distinct from Badge on purpose: a Badge
 * reports routine status anywhere; a Stamp marks a REAL EVENT (a permission
 * decision, a publish moment, a workflow gate) and should stay rare — if a
 * screen shows more than a handful, they should be Badges.
 *
 * Tones: `affirm` = the working ink (allowed, routine gates); `event` and
 * `refuse` = the pop ink, which marks that SOMETHING HAPPENED — a publish
 * moment (event) or a denial (refuse). The two pop tones render identically
 * on purpose (the ink flags the event, the LABEL carries the valence); they
 * stay separate names so call sites read semantically. All pairings AA in
 * both themes. `tilt` adds the hand-stamped tell — max ONE tilted Stamp per
 * cluster, and never on data-dense admin tables.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';

type StampTone = 'affirm' | 'event' | 'refuse';
type StampTilt = 'none' | 'up' | 'down';

const TONE: Record<StampTone, string> = {
  affirm: 'border-accent-text text-accent-text',
  event: 'border-pop-text text-pop-text',
  refuse: 'border-pop-text text-pop-text',
};

const TILT: Record<StampTilt, string> = {
  none: '',
  up: '-rotate-3',
  down: 'rotate-3',
};

export function Stamp({
  children,
  tone = 'affirm',
  tilt = 'none',
  class: cls,
}: {
  children: unknown;
  tone?: StampTone;
  tilt?: StampTilt;
  class?: string;
}): JSX.Element {
  return (
    <span
      class={cx(
        'inline-flex items-center rounded-sm border-2 px-2 py-0.5 font-mono text-eyebrow font-semibold tracking-[0.14em] uppercase',
        TONE[tone],
        TILT[tilt],
        cls,
      )}
    >
      {children}
    </span>
  );
}
