/**
 * Render a caught save error as an inline Datastar fragment morphed into a target
 * element by id (200 — Datastar only applies 2xx patches; DATASTAR_PATTERNS.md).
 * Validation errors list their field issues; other AppErrors show their message.
 *
 * `targetId` defaults to `form-result` (the single-form case); pass a distinct id
 * for pages with more than one independently-erroring form (e.g. the account page's
 * profile vs. security forms), so each morphs its own live region.
 */

import type { Context } from 'hono';
import { AppError, InputValidationError, StaleRevisionError } from '@/lib/errors';

export interface SaveErrorOptions {
  /** Where to send the author when their copy is stale (D54): reload the
   *  current version, or compare it against theirs in the revision viewer. */
  readonly staleLinks?: { readonly reload: string; readonly compare: string };
}

export function renderSaveError(
  c: Context,
  err: unknown,
  targetId = 'form-result',
  opts: SaveErrorOptions = {},
): Response | Promise<Response> {
  if (err instanceof StaleRevisionError && opts.staleLinks) {
    return c.html(
      <div
        id={targetId}
        role="alert"
        class="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger"
      >
        <p class="font-medium">Not saved — someone else saved first.</p>
        <p class="mt-1">{err.friendlyMessage}</p>
        <p class="mt-2 flex gap-4">
          <a href={opts.staleLinks.compare} class="font-medium underline">
            Compare revisions
          </a>
          <a href={opts.staleLinks.reload} class="font-medium underline">
            Reload latest (discards your unsaved edits)
          </a>
        </p>
      </div>,
    );
  }
  const issues =
    err instanceof InputValidationError && err.details
      ? err.details
      : err instanceof AppError
        ? [{ message: err.friendlyMessage }]
        : [{ message: 'Something went wrong — please try again.' }];

  return c.html(
    <div id={targetId} role="alert" class="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
      <p class="font-medium">Could not save:</p>
      <ul class="mt-1 list-disc pl-5">
        {issues.map((i) => (
          <li>
            {i.path ? <span class="font-mono">{i.path}</span> : null}
            {i.path ? ' — ' : ''}
            {i.message}
          </li>
        ))}
      </ul>
    </div>,
  );
}
