import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { anonymousPrincipal, principalFromSession } from '@/access';
import { getSessionUser } from '@/lib/auth';
import {
  getDocument,
  getDocumentBySlug,
  getBacklinks,
  buildSearchText,
} from '@/services/documents';
import { getCollectionOrThrow } from '@/services/collections';
import { getSettings } from '@/services/settings';
import { publicUrlOf } from '@/lib/def-helpers';
import { buildDocumentHead } from '@/lib/seo';
import { resolveBaseUrl } from '@/lib/base-url';
import { readingTimeMinutes } from '@/lib/reading-time';
import { resolveTemplate } from '@/templates/registry';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';
import { PublicShell, PublicNotFound } from '@/components/layouts/public-shell';
import { DocumentView, rawPageHtml } from '@/components/document-view';
import { Script } from 'vite-ssr-components/hono';
import { hasAnnotatableFields } from '@/services/comments';
import { principalPanel } from '@/lib/review-http';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /:collection/:slug — the PUBLIC rendered page (C2). By default the
 * anonymous principal flows through the same `authorize()`/`compileReadFilter`
 * machinery as REST, so only published documents in publicRead collections
 * resolve. Accepts a slug (the pretty URL) or a `doc_…` id (the universal
 * fallback relation links use). Anything unreadable — missing, draft, or
 * non-public — renders ONE indistinguishable 404 (existence is never leaked,
 * and the global onError's admin redirect is deliberately bypassed here).
 *
 * Draft preview (D49): `?preview=1` + a valid session swaps in the SESSION
 * principal — the identical pipeline with a real principal, so role perms
 * decide (admin/editor see drafts, an author their own, a reader the same 404
 * as anonymous — fail-closed). Flag without session redirects to login BEFORE
 * any lookup (no draft-existence oracle). Preview responses are no-store +
 * noindex and carry the author banner. Without the flag a logged-in admin sees
 * exactly what anonymous sees — deliberate (no "works for me" confusion).
 * Raw-mode (D27) drafts preview verbatim with no banner: the document IS the
 * page. Backlinks in preview use the same session principal (one principal per
 * request), so they may include referrers from other drafts the live page
 * won't show — useful to an author, and simpler than a split-principal read.
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const collection = pathParam(c, 'collection');
  const ref = pathParam(c, 'slug');

  const previewRequested = c.req.query('preview') != null;
  const sessionUser = previewRequested ? getSessionUser(c) : null;
  if (previewRequested && !sessionUser) {
    const url = new URL(c.req.url);
    return c.redirect(`/admin/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }
  const preview = previewRequested && sessionUser !== null;
  const principal = sessionUser ? principalFromSession(sessionUser) : anonymousPrincipal('rest');
  if (preview) c.header('Cache-Control', 'no-store');
  const settings = await getSettings(db);

  try {
    const def = await getCollectionOrThrow(db, collection);
    const doc = ref.startsWith('doc_')
      ? await getDocument(db, principal, collection, ref, now)
      : await getDocumentBySlug(db, principal, collection, ref, now);
    // Unlisted (D50): the X-Robots-Tag header — some crawlers act on it
    // before ever parsing the body — set BEFORE the raw-mode early return
    // below, so an unlisted raw-mode (D27) page still gets it.
    if (doc.visibility === 'unlisted') c.header('X-Robots-Tag', 'noindex');
    // Raw mode (D27): the html field IS the page — a full standalone document,
    // bypassing RootLayout/PublicShell. authorize already gated above; the
    // security headers middleware still applies.
    const raw = rawPageHtml(def, doc);
    if (raw !== null) return c.html(raw);
    const backlinks = await getBacklinks(db, principal, collection, doc.id, now);

    // Per-page head (D36): full title composed HERE (the layout does no DB
    // reads); canonical is the slug-or-id public URL; og:image resolves from
    // `social_image`/the template's hero slot/the first media field, in
    // `buildDocumentHead` (`lib/seo.ts`).
    const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
    const body = buildSearchText(def, doc.data)?.body ?? '';
    // `canonical` is the document's own blessed URL (slug for public docs,
    // `doc_…` for unlisted — `publicUrlOf` already resolves that); `publicUrl`
    // is wherever the reader actually landed, used for `og:url` regardless
    // (D52 — unlisted documents advertise their doc_ URL even though it isn't
    // a canonical link).
    const canonical = publicUrlOf(def, doc, baseUrl);
    const requestUrl = new URL(c.req.url);
    const publicUrl = `${baseUrl}${requestUrl.pathname}`;
    const indexable = !preview && doc.status === 'published' && doc.visibility !== 'unlisted';
    const head = buildDocumentHead({
      def,
      doc,
      settings,
      baseUrl,
      canonicalUrl: canonical,
      publicUrl,
      bodyText: body,
      media: doc.media,
      indexable,
      template: def.template,
    });

    // A registered template renders the reading layout; otherwise the generic
    // shell (DocumentView). `renderMode: 'raw'` already short-circuited above.
    // Reading time and the reader-share island are template CAPABILITIES
    // (tpl.wants) — a template that renders neither loads neither.
    const tpl = resolveTemplate(def.template);
    const wants = tpl?.wants ?? {};
    const content = tpl ? (
      <tpl.Component
        def={def}
        doc={doc}
        backlinks={backlinks}
        ctx={{
          settings,
          baseUrl,
          readingMinutes: wants.readingTime ? readingTimeMinutes(body) : 0,
          shareUrl: wants.shareBar ? canonical : undefined,
        }}
      />
    ) : (
      <DocumentView def={def} doc={doc} backlinks={backlinks} surface="public" settings={settings} />
    );

    // Review overlay (D55): `?preview=1&review=1` with a session adds the
    // principal's review panel. A principal who may read but not comment just
    // gets the plain preview — never an error page.
    let reviewPanel: unknown = null;
    if (preview && c.req.query('review') != null && hasAnnotatableFields(def)) {
      try {
        reviewPanel = await principalPanel(db, principal, collection, doc.id, now);
      } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
      }
    }

    return c.render(
      <PublicShell
        settings={settings}
        // Masthead wayfinding: link to the public collection index — only when
        // that index actually resolves (publicRead; lifecycle is implied for a
        // page that itself rendered).
        indexLink={
          def.access?.publicRead ? { href: `/${def.slug}`, label: `More ${def.name}` } : undefined
        }
        preview={
          preview
            ? { editHref: `/admin/c/${collection}/${doc.id}`, status: doc.status }
            : undefined
        }
      >
        {content}
        {wants.shareBar ? <Script src="/src/client/share.ts" /> : null}
        {reviewPanel}
        {reviewPanel ? <Script src="/src/client/review.ts" /> : null}
      </PublicShell>,
      head,
    );
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) {
      c.status(404);
      return c.render(
        <PublicShell settings={settings}>
          <PublicNotFound />
        </PublicShell>,
        { noindex: true },
      );
    }
    throw e;
  }
});
