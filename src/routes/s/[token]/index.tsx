import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env } from '@/types';
import type { SiteSettings } from '@/services/settings';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { openShareLink, unlockShareLink } from '@/services/access';
import { getSharedDocument, getBacklinks, buildSearchText } from '@/services/documents';
import { anonymousPrincipal } from '@/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { readingTimeMinutes } from '@/lib/reading-time';
import { resolveTemplate } from '@/templates/registry';
import { publicUrlOf } from '@/lib/def-helpers';
import { buildDocumentHead } from '@/lib/seo';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';
import { rateLimit, consumeRateLimit, SHARE_UNLOCK_RATE_LIMIT, SHARE_UNLOCK_LINK_RATE_LIMIT } from '@/middleware/rate-limit';
import { hashToken } from '@/lib/token';
import { PublicShell, PublicNotFound } from '@/components/layouts/public-shell';
import { DocumentView, rawPageHtml } from '@/components/document-view';
import { Card, CardContent, Button, FormField, Input } from '@/components/ui';
import { isReviewLink } from '@/services/comments';
import { reviewerRequest, reviewerPanel } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

const UNLOCK_COOKIE = 'rm_unlock';

function cookiePath(token: string): string {
  return `/s/${token}`;
}

/** The blanket "protected" card (D51) — no title, description, image, or OG/
 *  JSON-LD leak anything about the document behind a locked link. */
function LockedCard({ token, error }: { token: string; error?: string }) {
  return (
    <Card class="max-w-md">
      <CardContent class="flex flex-col gap-4 pt-6">
        <div>
          <h1 class="font-display text-display-sm text-ink">This link is protected</h1>
          <p class="mt-1 text-sm text-ink-muted">
            Enter the password you were given to read it.
          </p>
        </div>
        {error ? (
          <div role="alert" class="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {error}
          </div>
        ) : null}
        <form method="post" action={`/s/${token}`} class="flex flex-col gap-3">
          <FormField fieldId="password" label="Password">
            <Input
              id="password"
              name="password"
              type="password"
              required
              autocomplete="current-password"
              autofocus
            />
          </FormField>
          <Button type="submit" variant="primary">
            Unlock
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Render the LOCKED state — the one place that owns `Cache-Control` + the head
 * for it, so GET (no attempt yet) and POST (wrong password) stay identical.
 * Always `private, no-store`: a locked page must never be cached by an
 * intermediary that might later serve it to someone without the password.
 * `bare` strips every social/crawler tag — the page names nothing.
 */
function renderLocked(c: Context<{ Bindings: Env }>, settings: SiteSettings, token: string, error?: string) {
  c.header('Cache-Control', 'private, no-store');
  return c.render(
    <PublicShell settings={settings}>
      <LockedCard token={token} error={error} />
    </PublicShell>,
    { title: 'Protected link', bare: true, noindex: true },
  );
}

/**
 * GET /s/:token — consume a SHARE LINK (C3/D51). The token resolves to an
 * item_grants row (subjectKind 'link'); the read then runs through the same
 * `authorize()` machinery as everything else, with the link identity carried
 * on an anonymous principal. `openShareLink` additionally gates on a password
 * when the grant carries one (locked/open), never leaking document content
 * before unlock. Unknown, expired, and revoked tokens — and grants without
 * `read` — all render ONE indistinguishable 404. An `Accept:
 * application/json` request gets the document as JSON instead of HTML (or the
 * LOCKED error shape).
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const settings = await getSettings(db);
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  const token = pathParam(c, 'token');

  // Every /s/ response is noindex, protected or not — capability URLs are
  // never meant to be crawled or listed (2f).
  c.header('X-Robots-Tag', 'noindex');

  const notFound = () => {
    if (wantsJson) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    c.status(404);
    return c.render(
      <PublicShell settings={settings}>
        <PublicNotFound />
      </PublicShell>,
      { noindex: true },
    );
  };

  const resolved = await openShareLink(db, token, getCookie(c, UNLOCK_COOKIE), c.env.SESSION_SECRET, now);
  if (!resolved) return notFound();

  // A password-protected link is NEVER cacheable — locked or open, JSON or
  // HTML or raw — so this is set before any response arm can return.
  if (resolved.grant.hasPassword) c.header('Cache-Control', 'private, no-store');

  if (resolved.state === 'locked') {
    if (wantsJson) return c.json({ error: 'Password required', code: 'LOCKED' }, 401);
    return renderLocked(c, settings, token);
  }

  const grant = resolved.grant;
  try {
    const { doc, def } = await getSharedDocument(db, grant, now);
    if (wantsJson) return c.json({ data: doc });
    // Raw mode (D27): the html field IS the page (JSON arm stays first above).
    const raw = rawPageHtml(def, doc);
    if (raw !== null) return c.html(raw);
    // Backlinks stay access-scoped: the link grants ONE document, so referrers
    // only appear when they're independently public.
    const backlinks = await getBacklinks(
      db,
      { ...anonymousPrincipal('rest'), linkId: grant.subjectId },
      doc.collection,
      doc.id,
      now,
    );
    const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
    const body = buildSearchText(def, doc.data)?.body ?? '';
    // Canonical only when the underlying document is published AND public
    // (buildDocumentHead enforces this itself); the share-link URL is always
    // the current og:url regardless, so a private/unlisted document's slug
    // never leaks through a share link either.
    const canonical = publicUrlOf(def, doc, baseUrl);
    const publicUrl = `${baseUrl}/s/${token}`;
    const head = buildDocumentHead({
      def,
      doc,
      settings,
      baseUrl,
      canonicalUrl: canonical,
      publicUrl,
      bodyText: body,
      media: doc.media,
      indexable: false,
      template: def.template,
    });

    // A shared item renders through the same template as its public page — but
    // with NO shareUrl (a private link never advertises a public share).
    // Reading time is a template capability (tpl.wants), same as the public route.
    const tpl = resolveTemplate(def.template);
    const content = tpl ? (
      <tpl.Component
        def={def}
        doc={doc}
        backlinks={backlinks}
        ctx={{
          settings,
          baseUrl,
          readingMinutes: tpl.wants?.readingTime
            ? readingTimeMinutes(body)
            : 0,
        }}
      />
    ) : (
      <DocumentView def={def} doc={doc} backlinks={backlinks} surface="public" settings={settings} />
    );
    // A review link (D55) adds the review panel + island. Never cacheable:
    // the panel is per-reviewer.
    if (isReviewLink(grant)) {
      c.header('Cache-Control', 'private, no-store');
      const panel = await reviewerPanel(await reviewerRequest(c));
      return c.render(
        <PublicShell settings={settings} reviewInvite>
          {content}
          {panel}
          <Script src="/src/client/review.ts" />
        </PublicShell>,
        head,
      );
    }
    return c.render(<PublicShell settings={settings}>{content}</PublicShell>, head);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) return notFound();
    throw e;
  }
});

/**
 * POST /s/:token — attempt to unlock a password-protected share link (D51).
 * Rate-limited (SHARE_UNLOCK_RATE_LIMIT) — guessing a link password is the
 * same brute-force surface as login. Success sets the `rm_unlock` cookie,
 * scoped to this one link's path, then 303s back to GET. Failure re-renders
 * the SAME locked page with a generic error (no enumeration oracle: an
 * unknown token and a wrong password look identical).
 */
export const onRequestPost = factory.createHandlers(rateLimit('share-unlock', SHARE_UNLOCK_RATE_LIMIT), async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const token = pathParam(c, 'token');
  // A SECOND bucket, keyed to the link itself (its hash — never the
  // plaintext) rather than the caller's IP — a distributed guesser working
  // one link from many addresses still trips this one.
  await consumeRateLimit(c.env.RATE_LIMIT, 'share-unlock-link', SHARE_UNLOCK_LINK_RATE_LIMIT, await hashToken(token));
  const form = await c.req.parseBody();
  const password = String(form.password ?? '');

  const result = await unlockShareLink(db, token, password, c.env.SESSION_SECRET, now);
  if (result.ok) {
    setCookie(c, UNLOCK_COOKIE, result.cookieValue, {
      path: cookiePath(token),
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: result.maxAgeSeconds,
    });
    return c.redirect(`/s/${token}`, 303);
  }

  // A form re-render with an inline error is a 200, like /admin/login: a 401
  // answering a POST trips undici's auth-retry in the local dev relay.
  const settings = await getSettings(db);
  c.header('X-Robots-Tag', 'noindex');
  return renderLocked(c, settings, token, "That password didn't work.");
});
