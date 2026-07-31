/**
 * Card — a quiet surface container with a hairline border and soft shadow.
 * Compose with the header/title/description/content/footer helpers, or drop
 * children straight in. Titles default to <h3>; pass `as` to fit the page's
 * heading hierarchy (A11Y_STANDARDS.md — never a hard-coded h1 inside a card).
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';

export function Card({ children, class: cls }: { children: unknown; class?: string }): JSX.Element {
  return (
    <div class={cx('rounded-lg border border-border bg-surface text-ink shadow-xs', cls)}>{children}</div>
  );
}

export function CardHeader({ children, class: cls }: { children: unknown; class?: string }): JSX.Element {
  return <div class={cx('flex flex-col gap-1 px-5 pt-5', cls)}>{children}</div>;
}

export function CardTitle({
  children,
  as: As = 'h3',
  class: cls,
}: {
  children: unknown;
  as?: 'h2' | 'h3' | 'h4';
  class?: string;
}): JSX.Element {
  return (
    <As class={cx('font-display text-lg leading-snug font-semibold tracking-tight text-ink', cls)}>
      {children}
    </As>
  );
}

export function CardDescription({ children, class: cls }: { children: unknown; class?: string }): JSX.Element {
  return <p class={cx('text-sm text-ink-muted', cls)}>{children}</p>;
}

export function CardContent({ children, class: cls }: { children: unknown; class?: string }): JSX.Element {
  return <div class={cx('px-5 py-5', cls)}>{children}</div>;
}

export function CardFooter({ children, class: cls }: { children: unknown; class?: string }): JSX.Element {
  return <div class={cx('flex items-center gap-2 border-t border-border px-5 py-4', cls)}>{children}</div>;
}
