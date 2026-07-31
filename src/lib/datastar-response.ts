import type { Context } from 'hono';

/**
 * Datastar response helpers. See steering/DATASTAR_PATTERNS.md for the full contract.
 *
 * - Redirect: Datastar executes a `text/javascript` response body, so we return a
 *   one-line `window.location` assignment.
 * - Fragment (form actions): Datastar morphs a `text/html` response's top-level
 *   elements onto the DOM by id (default mode `outer`). A handler returns its
 *   fragment wrapped in `<div id="target">…</div>` and it replaces the live
 *   `#target`. Reliable for `@post` actions fired by a user gesture.
 * - Lazy on-load fragments: do NOT use Datastar `@get` — it re-fires and (with an
 *   SSE body) full-page-reloads these slots. Use a client lazy-fetch island.
 *
 * ALL responses here are 200: Datastar only applies patches from 2xx responses.
 */

/** Navigate the browser to `url` (full-page) from a Datastar action response. */
export function dsRedirect(c: Context, url: string): Response {
  return c.body(`window.location.href = ${JSON.stringify(url)};`, 200, {
    'Content-Type': 'text/javascript; charset=utf-8',
  });
}

/**
 * Surface an unexpected error to a Datastar action. Datastar only applies patches
 * from 2xx responses, so a non-2xx JSON body leaves the action silently dead (busy
 * state sticks with no feedback). Instead return a 200 `text/javascript` body that
 * dispatches a global `app-error` event (for a toast listener) and falls back to a
 * native `alert`, so the failure is always visible.
 */
export function dsError(c: Context, message: string): Response {
  const msg = JSON.stringify(message);
  const script =
    `(function(){var m=${msg};` +
    `try{window.dispatchEvent(new CustomEvent('app-error',{detail:{message:m}}));}catch(e){}` +
    `window.alert(m);})();`;
  return c.body(script, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
}

/**
 * Escape a value for safe inclusion inside a single-quoted JS string literal in a
 * `data-on:*` expression (e.g. `confirm('Delete ${jsLiteral(name)}?')`). Hono does
 * not escape `'` in attribute values, so a user-controlled name containing a quote
 * would otherwise break out of the expression.
 */
export function jsLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}
