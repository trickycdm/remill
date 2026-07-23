/**
 * Security response headers (SECURITY_STANDARDS.md §8, SEC-3), forked per
 * surface since D27:
 *
 *  - PROTECTED surfaces (/admin, /api, /mcp, /auth, /media) always get the
 *    strict policy.
 *  - PUBLIC surfaces (/, /:collection/:slug, /s/:token) get the same strict
 *    policy by default, widening `script-src` to the CDN allowlist ONLY while
 *    the admin-settable `allowCdnScripts` setting is on.
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

const PROTECTED_PREFIXES = ['/admin', '/api', '/mcp', '/auth', '/media', '/oauth'] as const;

/** Exact hosts only — never wildcards. Documented in the settings help copy. */
export const CDN_SCRIPT_HOSTS = ['https://cdn.jsdelivr.net', 'https://unpkg.com'] as const;

function policy(extraScriptSrc: readonly string[] = []) {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...extraScriptSrc],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
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
const publicCdn = policy(CDN_SCRIPT_HOSTS);

/** One dispatcher for every route: strict on protected prefixes; on public
 *  paths, one settings PK read decides strict vs CDN-widened. */
export function securityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const p = c.req.path;
    if (PROTECTED_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return strict(c, next);
    const settings = await getSettings(getDb(c.env.DB));
    return (settings.allowCdnScripts ? publicCdn : strict)(c, next);
  };
}
