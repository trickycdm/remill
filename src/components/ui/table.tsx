/**
 * Table — real <table> semantics for the generated list view (A11Y_STANDARDS.md
 * requires <th scope>, and a caption or aria-label). Composed from typed helpers
 * so field CellComponents render into TableCell and never hand-roll markup.
 *
 *   <Table caption="Posts">
 *     <TableHead>
 *       <TableRow>
 *         <TableHeaderCell>Title</TableHeaderCell>
 *         <TableHeaderCell class="text-right">Updated</TableHeaderCell>
 *       </TableRow>
 *     </TableHead>
 *     <TableBody>
 *       <TableRow><TableCell>…</TableCell>…</TableRow>
 *     </TableBody>
 *   </Table>
 *
 * The scroll container keeps a wide table from breaking the page layout while
 * staying keyboard-scrollable.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { cx } from '@/components/ui/cx';

export function Table({
  children,
  caption,
  class: cls,
  'aria-label': ariaLabel,
}: {
  children: unknown;
  /** Accessible table name — rendered as a visually-hidden <caption>. */
  caption?: string;
  class?: string;
  'aria-label'?: string;
}): JSX.Element {
  return (
    <div class="w-full overflow-x-auto rounded-lg border border-border">
      <table class={cx('w-full border-collapse text-left text-sm text-ink', cls)} aria-label={ariaLabel}>
        {caption ? <caption class="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children, class: cls }: { children: unknown; class?: string }): JSX.Element {
  return <thead class={cx('bg-surface', cls)}>{children}</thead>;
}

export function TableBody({ children, class: cls }: { children: unknown; class?: string }): JSX.Element {
  return <tbody class={cls}>{children}</tbody>;
}

export function TableRow({
  children,
  class: cls,
  ...rest
}: {
  children: unknown;
  class?: string;
  readonly [attr: `data-${string}`]: unknown;
}): JSX.Element {
  return (
    <tr
      class={cx('border-b border-border last:border-0 transition-colors hover:bg-hover/60', cls)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </tr>
  );
}

export function TableHeaderCell({
  children,
  scope = 'col',
  class: cls,
}: {
  children: unknown;
  scope?: 'col' | 'row';
  class?: string;
}): JSX.Element {
  const base =
    scope === 'col'
      ? 'px-4 py-3 font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase'
      : 'px-4 py-3 text-sm font-medium text-ink';
  return (
    <th scope={scope} class={cx(base, cls)}>
      {children}
    </th>
  );
}

export function TableCell({
  children,
  class: cls,
  colspan,
}: {
  children: unknown;
  class?: string;
  colspan?: number;
}): JSX.Element {
  return (
    <td colspan={colspan} class={cx('px-4 py-3 align-middle text-ink', cls)}>
      {children}
    </td>
  );
}
