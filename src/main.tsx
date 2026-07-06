import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { securityHeaders } from '@/middleware/security-headers';
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

// Security response headers (SECURITY_STANDARDS.md §8, SEC-3) — strict policy
// on protected surfaces, settings-driven CDN allowlist on public pages (D27).
// The policies and the surface classifier live in src/middleware/security-headers.
app.use('*', securityHeaders());

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
