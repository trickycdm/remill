/**
 * Render a caught save error as an inline Datastar fragment morphed into
 * `#form-result` (200 — Datastar only applies 2xx patches; DATASTAR_PATTERNS.md).
 * Validation errors list their field issues; other AppErrors show their message.
 */

import type { Context } from 'hono';
import { AppError, InputValidationError } from '@/lib/errors';

export function renderSaveError(c: Context, err: unknown): Response | Promise<Response> {
  const issues =
    err instanceof InputValidationError && err.details
      ? err.details
      : err instanceof AppError
        ? [{ message: err.friendlyMessage }]
        : [{ message: 'Something went wrong — please try again.' }];

  return c.html(
    <div id="form-result" role="alert" class="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
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
