import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { anonymousPrincipal } from '@/access';
import {
  getDocument,
  getDocumentBySlug,
  getBacklinks,
  buildSearchText,
} from '@/services/documents';
import { getCollectionOrThrow } from '@/services/collections';
import { getSettings } from '@/services/settings';
import { titleOf, publicUrlOf, excerptFrom } from '@/lib/def-helpers';
import { resolveBaseUrl } from '@/lib/base-url';
import { readingTimeMinutes } from '@/lib/reading-time';
import { resolveTemplate } from '@/templates/registry';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';
import { PublicShell, PublicNotFound } from '@/components/layouts/public-shell';
import { DocumentView, rawPageHtml } from '@/components/document-view';
import { Script } from 'vite-ssr-components/hono';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /:collection/:slug — the PUBLIC rendered page (C2). No auth: the
 * anonymous principal flows through the same `authorize()`/`compileReadFilter`
 * machinery as REST, so only published documents in publicRead collections
 * resolve. Accepts a slug (the pretty URL) or a `doc_…` id (the universal
 * fallback relation links use). Anything unreadable — missing, draft, or
 * non-public — renders ONE indistinguishable 404 (existence is never leaked,
 * and the global onError's admin redirect is deliberately bypassed here).
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const collection = pathParam(c, 'collection');
  const ref = pathParam(c, 'slug');
  const principal = anonymousPrincipal('rest');
  const settings = await getSettings(db);

  try {
    const def = await getCollectionOrThrow(db, collection);
    const doc = ref.startsWith('doc_')
      ? await getDocument(db, principal, collection, ref, now)
      : await getDocumentBySlug(db, principal, collection, ref, now);
    // Raw mode (D27): the html field IS the page — a full standalone document,
    // bypassing RootLayout/PublicShell. authorize already gated above; the
    // security headers middleware still applies.
    const raw = rawPageHtml(def, doc);
    if (raw !== null) return c.html(raw);
    const backlinks = await getBacklinks(db, principal, collection, doc.id, now);

    // Per-page head (D36): full title composed HERE (the layout does no DB
    // reads); canonical is the slug-or-id public URL; og:image is the first
    // media field's file, when set.
    const baseUrl = resolveBaseUrl(c.env, settings, c.req.url);
    const siteName = settings.siteName?.trim() || 'remill';
    const body = buildSearchText(def, doc.data)?.body ?? '';
    const canonical = publicUrlOf(def, doc, baseUrl);
    const mediaField = def.fields.find((f) => f.type === 'media');
    const mediaId = mediaField ? doc.data[mediaField.key] : undefined;

    // A registered template renders the reading layout; otherwise the generic
    // shell (DocumentView). `renderMode: 'raw'` already short-circuited above.
    const tpl = resolveTemplate(def.template);
    const content = tpl ? (
      <tpl.Component
        def={def}
        doc={doc}
        backlinks={backlinks}
        ctx={{ settings, baseUrl, readingMinutes: readingTimeMinutes(body), shareUrl: canonical }}
      />
    ) : (
      <DocumentView def={def} doc={doc} backlinks={backlinks} surface="public" />
    );

    return c.render(
      <PublicShell settings={settings}>
        {content}
        {/* Reader-share island — a no-op on pages without a share bar (§g). */}
        {tpl ? <Script src="/src/client/share.ts" /> : null}
      </PublicShell>,
      {
        title: `${titleOf(def, doc)} — ${siteName}`,
        description: excerptFrom(body) || undefined,
        canonical,
        ogType: 'article',
        ogImage:
          typeof mediaId === 'string' && mediaId.length ? `${baseUrl}/media/${mediaId}` : undefined,
        feedUrl: '/rss.xml',
      },
    );
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) {
      c.status(404);
      return c.render(
        <PublicShell settings={settings}>
          <PublicNotFound />
        </PublicShell>,
      );
    }
    throw e;
  }
});
