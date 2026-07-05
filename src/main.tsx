import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from '@/types';
import { RootLayout } from '@/layouts';
import { sessionSetup } from '@/middleware/session';
import { rateLimit, GLOBAL_RATE_LIMIT } from '@/middleware/rate-limit';
import { AppError, ForbiddenError } from '@/lib/errors';
import { dsRedirect, dsError } from '@/lib/datastar-response';
import { getDb } from '@/db/client';
import { generateOpenApi } from '@/lib/openapi';
import { loadRoutes } from './router';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.use(logger());

// Security response headers (SECURITY_STANDARDS.md §8, SEC-3). The CSP is crafted
// to keep the admin working: Datastar is vendored same-origin (`'self'`) and
// compiles its `data-*` expressions with the `Function` constructor, so
// `script-src` MUST allow `'unsafe-eval'`; `'unsafe-inline'` covers the theme-init
// snippet + `data-signals` bootstrap and Tailwind's inline styles. `connect-src
// 'self'` permits Datastar SSE and Vite's same-origin HMR websocket in dev.
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
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
  }),
);

// Soft site-wide rate limit (SEC-2). No-ops without the KV binding (tests).
app.use('*', rateLimit('global', GLOBAL_RATE_LIMIT));

app.use('*', sessionSetup()); // must run before any auth-reading route
app.use('*', RootLayout);

// ---------------------------------------------------------------------------
// Global error handler — see steering/ERROR_HANDLING.md
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  // Datastar actions follow 3xx into HTML (which would morph the current page),
  // and only apply 2xx patches — so auth failures for them must navigate via a
  // text/javascript redirect, and other errors surface via dsError (also 200).
  const isDatastar = c.req.header('Datastar-Request') === 'true';
  // REST + MCP live under /api and /mcp — machine callers get JSON, never redirects.
  const isMachine = c.req.path.startsWith('/api') || c.req.path.startsWith('/mcp');

  if (err instanceof AppError) {
    if (err.status === 401) {
      const target = `/admin/login?redirect=${encodeURIComponent(c.req.path)}`;
      if (isMachine) return c.json({ error: err.friendlyMessage, code: err.code }, 401);
      return isDatastar ? dsRedirect(c, target) : c.redirect(target);
    }

    if (err.status === 403) {
      // Structured deny shape (ACCESS_CONTROL.md) for machine callers.
      if (isMachine) {
        const missing = err instanceof ForbiddenError ? err.missing : undefined;
        return c.json({ error: err.friendlyMessage, code: err.code, missing }, 403);
      }
      if (isDatastar) return dsError(c, err.friendlyMessage);
      return c.redirect('/admin');
    }

    if (isDatastar) return dsError(c, err.friendlyMessage);
    return c.json(
      { error: err.friendlyMessage, code: err.code, details: err.details },
      err.status as 400 | 404 | 409 | 422 | 500,
    );
  }

  console.error('[unhandled]', err);
  if (isDatastar) return dsError(c, 'Something went wrong — please try again');
  return c.json({ error: 'Something went wrong — please try again', code: 'INTERNAL_ERROR' }, 500);
});

// ---------------------------------------------------------------------------
// Routes — generated from src/routes/ by hono-router (bun run routes).
// Never register routes here by hand; add a file under src/routes/ with
// onRequestGet / onRequestPost / … exports and regenerate.
// ---------------------------------------------------------------------------

// The one hand-registered route: hono-router can't emit a valid import identifier
// for a filename containing a dot, and this endpoint needs the literal
// `/api/openapi.json` URL (surface 5). Generated from live definitions.
app.get('/api/openapi.json', async (c) => {
  const doc = await generateOpenApi(getDb(c.env.DB), c.env.BASE_URL ?? '');
  return c.json(doc);
});

loadRoutes(app);

app.notFound((c) => {
  c.status(404);
  return c.render(
    <main class="flex min-h-screen items-center justify-center p-8">
      <div class="text-center">
        <h1 class="text-4xl font-bold">404</h1>
        <p class="mt-2 opacity-70">Page not found</p>
        <a href="/admin" class="mt-4 inline-block text-sm underline">
          Go to admin
        </a>
      </div>
    </main>,
  );
});

export default app;
