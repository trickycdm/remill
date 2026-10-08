/**
 * Security response headers (SECURITY_STANDARDS.md §8, SEC-3), forked per
 * surface since D27:
 *
 *  - PROTECTED surfaces (/admin, /api, /mcp, /auth, /media, /oauth) always get
 *    the strict policy.
 *  - PUBLIC surfaces (/, /:collection/:slug, /s/:token) get the same strict
 *    policy by default, widening `script-src` to the CDN allowlist ONLY while
 *    the admin-settable `allowCdnScripts` setting is on.
 *  - An INLINE PAGE (D63 — any route that renders an inline-mode document,
 *    public or admin) gets the page policy: the site policy plus the
 *    resources an inline page may load (`@/lib/inline/policy`). The route
 *    opts in with `usePagePolicy(c)`; the headers are applied after the
 *    handler runs, so the choice can depend on what it rendered.
 *  - The FRAME surface (/frame/:ticket, D60) gets its own policy from
 *    `@/lib/frame/policy`: the author's document is sandboxed into an opaque
 *    origin and may be framed by remill's own shell — the ONE response family
 *    without `X-Frame-Options: DENY` / `frame-ancestors 'none'`.
 *
 * The CSP keeps the admin working: Datastar is vendored same-origin (`'self'`)
 * and compiles its `data-*` expressions with the `Function` constructor, so
 * `script-src` MUST allow `'unsafe-eval'`; `'unsafe-inline'` covers the
 * theme-init snippet + `data-signals` bootstrap and Tailwind's inline styles —
 * and it is also what lets trusted `html`-field pages run inline chart code
 * (D25). `connect-src 'self'` permits Datastar SSE and Vite's same-origin HMR
 * websocket in dev.
 *
 * CLASSIFIER CAVEAT: the split is prefix-based. A future top-level route added
 * outside PROTECTED_PREFIXES silently gets the PUBLIC policy — add new
 * protected surfaces to the list here.
 */

import { secureHeaders } from 'hono/secure-headers';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { getSettings } from '@/services/settings';
import { frameResponseHeaders } from '@/lib/frame/policy';
import { PAGE_CSP_SOURCES } from '@/lib/inline/policy';
import type { Context } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by a route that rendered an inline page (D63). */
    pagePolicy?: boolean;
  }
}

/** Mark this response as an inline page (D63): it gets the page policy. */
export function usePagePolicy(c: Context): void {
  c.set('pagePolicy', true);
}

/** The framed-content prefix (D60). Checked BEFORE the protected/public split. */
export const FRAME_PREFIX = '/frame/';

const PROTECTED_PREFIXES = ['/admin', '/api', '/mcp', '/auth', '/media', '/oauth'] as const;

/** Exact hosts only — never wildcards. Documented in the settings help copy. */
export const CDN_SCRIPT_HOSTS = ['https://cdn.jsdelivr.net', 'https://unpkg.com'] as const;

interface ExtraSources {
  readonly scriptSrc?: readonly string[];
  readonly styleSrc?: readonly string[];
  readonly fontSrc?: readonly string[];
  readonly imgSrc?: readonly string[];
  readonly mediaSrc?: readonly string[];
}

function policy(extra: ExtraSources = {}) {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...(extra.scriptSrc ?? [])],
      styleSrc: ["'self'", "'unsafe-inline'", ...(extra.styleSrc ?? [])],
      imgSrc: ["'self'", 'data:', ...(extra.imgSrc ?? [])],
      fontSrc: ["'self'", ...(extra.fontSrc ?? [])],
      ...(extra.mediaSrc ? { mediaSrc: [...extra.mediaSrc] } : {}),
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    // publicRead media is designed to be embedded/consumed cross-origin, so we do
    // NOT emit Cross-Origin-Resource-Policy (its `same-origin` default would block
    // hotlinking of /media assets). Other secure-headers defaults are kept.
    crossOriginResourcePolicy: false,
  });
}

const strict = policy();
const publicCdn = policy({ scriptSrc: CDN_SCRIPT_HOSTS });
const page = policy(PAGE_CSP_SOURCES);
const noop = async () => {};

/** The frame policy: set on the way out so it also covers the refusal document.
 *  Keyed to the REQUEST origin — never the admin-editable site URL. */
const frame: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(frameResponseHeaders(new URL(c.req.url).origin))) {
    c.res.headers.set(name, value);
  }
};

/** One dispatcher for every route: the frame policy on framed content; the
 *  page policy on an inline page; strict on protected prefixes; on public
 *  paths, one settings PK read decides strict vs CDN-widened. Each policy
 *  sets its headers on the way out, so it runs after the handler (with a
 *  no-op `next`) and the handler's `usePagePolicy` can choose it. */
export function securityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const p = c.req.path;
    if (p.startsWith(FRAME_PREFIX)) return frame(c, next);
    const isProtected = PROTECTED_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
    const settings = isProtected ? null : await getSettings(getDb(c.env.DB));
    await next();
    const chosen = c.get('pagePolicy') ? page : settings?.allowCdnScripts ? publicCdn : strict;
    await chosen(c, noop);
  };
}
