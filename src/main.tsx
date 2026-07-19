import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { securityHeaders } from '@/middleware/security-headers';
import type { Env } from '@/types';
import { RootLayout } from '@/layouts';
import { sessionSetup } from '@/middleware/session';
import { AppError, ForbiddenError } from '@/lib/errors';
import { dsRedirect, dsError } from '@/lib/datastar-response';
import { getDb } from '@/db/client';
import { generateOpenApi } from '@/lib/openapi';
import { resolvePrincipal } from '@/lib/api-auth';
import { listDiscoverableCollections } from '@/services/collections';
import { rssXml, sitemapXml, robotsTxt } from '@/lib/feeds';
import { recentPublishedDocs, allPublishedDocs } from '@/services/discovery';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { nowIso } from '@/lib/now';
import { runScheduled } from '@/jobs';
import { loadRoutes } from './router';

// Named export: tests drive the Hono instance directly via `app.request(...)`
// (the default export is the two-handler Worker shape below, which has no
// request helper).
export const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.use(logger());

// Security response headers (SECURITY_STANDARDS.md §8, SEC-3) — strict policy
// on protected surfaces, settings-driven CDN allowlist on public pages (D27).
// The policies and the surface classifier live in src/middleware/security-headers.
app.use('*', securityHeaders());

// No site-wide rate limiter here by design (D40): a global `app.use('*')` tier
// did one KV write per dynamic request, which exhausts the Cloudflare free-tier
// 1,000-writes/day budget under ordinary crawler traffic. Abuse-prone endpoints
// carry their own tight limiters (login/token/upload/import/join via
// `rateLimit()`); volumetric abuse is absorbed by Cloudflare's edge DDoS + WAF.

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

// Hand-registered routes: hono-router can't emit a valid import identifier for
// a filename containing a dot, and these endpoints need literal dotted URLs —
// `/api/openapi.json` (surface 5) and the public discovery pack (D35:
// /rss.xml, /sitemap.xml, /robots.txt — feed readers/crawlers expect exactly
// these paths). The discovery handlers read as the anonymous principal through
// the same gated pipeline as public pages; the public CSP applies automatically
// (they sit outside PROTECTED_PREFIXES — an intentional classification,
// SECURITY_STANDARDS.md).
app.get('/api/openapi.json', async (c) => {
  // The document is caller-scoped (D46): anonymous callers get the static paths
  // plus non-private collections; a bearer token widens it to whatever that
  // principal may discover. Same resolver as every REST route.
  const db = getDb(c.env.DB);
  const principal = await resolvePrincipal(db, c, 'rest', nowIso());
  const defs = await listDiscoverableCollections(db, principal);
  return c.json(generateOpenApi(defs, c.env.BASE_URL ?? ''));
});

app.get('/rss.xml', async (c) => {
  const db = getDb(c.env.DB);
  const settings = await getSettings(db);
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
  const collection = c.req.query('collection') || undefined;
  const docs = await recentPublishedDocs(db, nowIso(), { collection });
  const xml = rssXml({
    siteName: settings.siteName?.trim() || 'remill',
    siteDescription: settings.siteDescription ?? '',
    baseUrl,
    items: docs.map((d) => ({
      title: d.title,
      url: `${baseUrl}${d.path}`,
      excerpt: d.excerpt,
      publishedAt: d.publishedAt,
      id: d.id,
    })),
  });
  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
});

app.get('/sitemap.xml', async (c) => {
  const db = getDb(c.env.DB);
  const settings = await getSettings(db);
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
  const docs = await allPublishedDocs(db, nowIso());
  const xml = sitemapXml([
    { loc: `${baseUrl}/` },
    ...docs.map((d) => ({ loc: `${baseUrl}${d.path}`, lastmod: d.updatedAt })),
  ]);
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

app.get('/robots.txt', async (c) => {
  const settings = await getSettings(getDb(c.env.DB));
  const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
  return c.text(robotsTxt(baseUrl));
});

loadRoutes(app);

app.notFound((c) => {
  c.status(404);
  // On-system 404 (DESIGN_SYSTEM.md): tokens + the display face, the state
  // named in plain text (never colour alone), one path onward.
  return c.render(
    <main class="flex min-h-dvh items-center justify-center bg-canvas p-8 text-ink">
      <div class="flex flex-col items-center gap-3 text-center">
        <h1 class="rm-overprint-title font-display text-display-lg font-bold">404</h1>
        <p class="text-ink-muted">There is no page at this address.</p>
        <a
          href="/"
          class="mt-2 text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to the front page
        </a>
      </div>
    </main>,
  );
});

// The Worker exports both halves: fetch (the app) and scheduled (cron jobs, D31
// — see src/jobs). waitUntil keeps the invocation alive until the jobs settle.
export default {
  fetch: app.fetch,
  scheduled: (controller, env, ctx) => ctx.waitUntil(runScheduled(controller.cron, env)),
} satisfies ExportedHandler<Env>;
