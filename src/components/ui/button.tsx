/**
 * Button — the primary action primitive.
 *
 * Variants: primary (working-ink fill), secondary (surface + hairline), ghost
 * (transparent), danger (destructive fill), link (inline text action).
 * Sizes: sm | md | lg | icon (square, icon-only — requires `aria-label`).
 *
 * `href` renders a semantic <a>; otherwise a <button> (never role="button" on an
 * anchor — A11Y_STANDARDS.md). Focus ring inherited from the base focus-visible
 * rule plus an explicit ring for clarity. Disabled uses the real attribute.
 *
 * Datastar-friendly `busy` affordance: when a form is mid-submit the route binds
 *   <Button busy="$busy" type="submit">Save</Button>
 * `busy` accepts a Datastar expression string (e.g. "$busy") OR a boolean. It
 * drives `data-attr:disabled`, `data-attr:aria-busy`, and shows a spinner via
 * `data-show`, so the control disables optimistically and announces itself.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { Spinner } from '@/components/ui/icon';
import { CONTROL_H } from '@/components/ui/control';
import { cx } from '@/components/ui/cx';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover shadow-xs',
  secondary:
    'bg-surface text-ink border border-border-strong hover:bg-hover shadow-xs',
  ghost: 'bg-transparent text-ink-muted hover:bg-hover hover:text-ink',
  danger: 'bg-danger-solid text-white hover:brightness-110 shadow-xs',
  link: 'bg-transparent text-accent-text underline decoration-1 underline-offset-4 hover:decoration-2 px-0 h-auto',
};

// Height comes from the shared CONTROL_H so a Button can never drift out of
// alignment with an Input/Select beside it (item 7); px/text/gap stay per-size.
const SIZE: Record<ButtonSize, string> = {
  sm: `${CONTROL_H.sm} px-3 text-[13px] gap-1.5`,
  md: `${CONTROL_H.md} px-4 text-sm gap-2`,
  lg: `${CONTROL_H.lg} px-6 text-[15px] gap-2`,
  icon: 'size-10 p-0',
};

interface ButtonBase {
  children: unknown;
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  disabled?: boolean;
  id?: string;
  /** Datastar expression (e.g. "$busy") or boolean — disables + shows a spinner. */
  busy?: string | boolean;
  'aria-label'?: string;
  'aria-expanded'?: string | boolean;
  'aria-controls'?: string;
  'aria-current'?: string;
  'aria-haspopup'?: string;
  /** Island carrier attributes (e.g. data-share-copy) — props already spread. */
  [key: `data-${string}`]: string | boolean | undefined;
}

interface ButtonAsButton extends ButtonBase {
  href?: undefined;
  type?: 'button' | 'submit' | 'reset';
  name?: string;
  value?: string;
  form?: string;
  /** Datastar click handler, e.g. "@post('/x')". */
  'data-on:click'?: string;
}

interface ButtonAsAnchor extends ButtonBase {
  href: string;
  target?: string;
  rel?: string;
}

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-all duration-150 outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

export function Button(props: ButtonProps): JSX.Element {
  const { children, variant = 'primary', size = 'md', class: cls, busy, ...rest } = props;
  // Link variant is inline text — it opts out of the fixed control height/padding.
  const sizeClass = variant === 'link' ? '' : SIZE[size];
  const classes = cx(BASE, VARIANT[variant], sizeClass, cls);

  // Datastar busy affordance: string → reactive attrs; boolean → static.
  const busyAttrs =
    typeof busy === 'string'
      ? { 'data-attr:disabled': busy, 'data-attr:aria-busy': busy }
      : busy
        ? { disabled: true, 'aria-busy': 'true' }
        : {};

  const spinner =
    busy !== undefined ? (
      <span
        class="contents"
        {...(typeof busy === 'string' ? { 'data-show': busy, style: 'display:none' } : {})}
      >
        <Spinner class="rm-anim-spin -ml-0.5 size-4" />
      </span>
    ) : null;

  if ('href' in rest && rest.href !== undefined) {
    const { href, target, rel, disabled, ...aria } = rest as ButtonAsAnchor;
    return (
      <a
        href={href}
        target={target}
        rel={rel}
        class={classes}
        aria-disabled={disabled || undefined}
        {...(aria as Record<string, unknown>)}
      >
        {spinner}
        {children}
      </a>
    );
  }

  const { type = 'button', disabled, ...btnRest } = rest as ButtonAsButton;
  return (
    <button
      type={type}
      class={classes}
      disabled={disabled || undefined}
      {...busyAttrs}
      {...(btnRest as Record<string, unknown>)}
    >
      {spinner}
      {children}
    </button>
  );
}
