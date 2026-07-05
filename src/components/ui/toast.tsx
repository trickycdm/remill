/**
 * Toast — transient feedback.
 *
 * `Toast` is the presentational card (server-render it, or patch it into a host
 * with a Datastar SSE `patchElements` for save/upload feedback). `ToastHost` is
 * the always-present client listener that catches the global `app-error`
 * CustomEvent dispatched by `dsError` (src/lib/datastar-response.ts) when a
 * Datastar action fails, and surfaces it as a danger toast — so a failed @post
 * is always visible instead of silently sticking busy state.
 *
 * Render ONE <ToastHost /> in the admin shell (it lives inside <body>). Errors
 * use role="alert" (assertive); success/info use role="status" (polite).
 */

import {
  AlertTriangle,
  CircleCheck,
  CircleAlert,
  Info,
  X,
  type IconComponent,
} from '@/components/ui/icon';

type ToastTone = 'success' | 'danger' | 'warning' | 'info';

const TONE_ICON: Record<ToastTone, IconComponent> = {
  success: CircleCheck,
  danger: AlertTriangle,
  warning: CircleAlert,
  info: Info,
};

const TONE_ACCENT: Record<ToastTone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

export function Toast({
  children,
  title,
  tone = 'info',
  id,
  class: cls,
}: {
  children?: unknown;
  title?: unknown;
  tone?: ToastTone;
  id?: string;
  class?: string;
}) {
  const ToneIcon = TONE_ICON[tone];
  return (
    <div
      id={id}
      role={tone === 'danger' ? 'alert' : 'status'}
      class={`rm-anim-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 shadow-md${cls ? ` ${cls}` : ''}`}
    >
      <span class={`mt-0.5 shrink-0 ${TONE_ACCENT[tone]}`}>
        <ToneIcon class="size-5" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p class="text-sm font-semibold text-ink">{title}</p> : null}
        {children ? <p class="text-sm leading-normal text-ink-muted">{children}</p> : null}
      </div>
    </div>
  );
}

/**
 * ToastHost — client-side listener + slot. Seeds toast signals, listens for
 * `app-error` on window, and renders a dismissible danger toast bound to those
 * signals. Auto-dismisses after 6s; the ✕ dismisses immediately.
 */
export function ToastHost() {
  return (
    <div
      class="pointer-events-none fixed inset-0 z-[100] flex flex-col items-end justify-end gap-2 p-4 sm:p-6"
      data-signals="{toastShow: false, toastMsg: ''}"
      data-on:app-error__window="$toastMsg = (evt.detail && evt.detail.message) || 'Something went wrong.'; $toastShow = true; setTimeout(() => $toastShow = false, 6000)"
    >
      <div
        role="alert"
        aria-live="assertive"
        data-show="$toastShow"
        style="display:none"
        class="rm-anim-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-danger/40 bg-surface-raised px-4 py-3 shadow-md"
      >
        <span class="mt-0.5 shrink-0 text-danger">
          <AlertTriangle class="size-5" />
        </span>
        <p class="min-w-0 flex-1 text-sm leading-normal text-ink" data-text="$toastMsg">
          Something went wrong.
        </p>
        <button
          type="button"
          aria-label="Dismiss notification"
          class="-mr-1 -mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          data-on:click="$toastShow = false"
        >
          <X class="size-4" />
        </button>
      </div>
    </div>
  );
}
