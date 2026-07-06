import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { anonymousPrincipal } from '@/access';
import { getDocument, getDocumentBySlug, getBacklinks } from '@/services/documents';
import { getCollectionOrThrow } from '@/services/collections';
import { getSettings } from '@/services/settings';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';
import { PublicShell, PublicNotFound } from '@/components/layouts/public-shell';
import { DocumentView, rawPageHtml } from '@/components/document-view';

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
    return c.render(
      <PublicShell settings={settings}>
        <DocumentView def={def} doc={doc} backlinks={backlinks} surface="public" />
      </PublicShell>,
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
