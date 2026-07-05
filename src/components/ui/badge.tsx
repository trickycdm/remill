/**
 * Badge — small status pill. Colour NEVER carries meaning alone: the label text
 * is the signal, colour is reinforcement (A11Y_STANDARDS.md §Colour). An optional
 * leading dot adds a second non-text channel for status.
 *
 * Tones map to the semantic tokens; each `-soft` wash + `text-{tone}` pairing is
 * tuned AA in both themes (see tailwind.css). Use for draft/published, allow/deny,
 * roles, counts.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-hover text-ink-muted',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

const DOT: Record<BadgeTone, string> = {
  neutral: 'bg-ink-subtle',
  accent: 'bg-accent-text',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  class: cls,
}: {
  children: unknown;
  tone?: BadgeTone;
  dot?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <span
      class={cx(
        'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap',
        cls,
        TONE[tone],
      )}
    >
      {dot ? <span class={cx('size-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
