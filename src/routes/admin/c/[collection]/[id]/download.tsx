import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { getDocument, getRevisionData } from '@/services/documents';
import { titleOf } from '@/lib/def-helpers';
import { pageFieldOf } from '@/lib/frame/document';
import { NotFoundError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** A safe download filename from a document title (ASCII, no path or quote
 *  characters), falling back to the document id. */
function fileNameOf(title: string, fallback: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || fallback}.html`;
}

/**
 * GET /admin/c/:collection/:id/download[?rev=N] — the page's html (the
 * collection's first `html` field) exactly as stored, as a FILE. Always an
 * attachment: the author's markup must never render on the admin origin (D60),
 * and a download opens from disk, outside it. `?rev=N` downloads a past
 * revision (gated on `update`, like every read of history).
 */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const slug = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const now = nowIso();
  const principal = requirePrincipal(c);

  const def = await getCollectionOrThrow(db, slug);
  const doc = await getDocument(db, principal, slug, id, now);
  const key = pageFieldOf(def);
  const rev = Number(c.req.query('rev') ?? 0);
  const past = Number.isInteger(rev) && rev > 0 && rev !== doc.revision;
  const data = past ? await getRevisionData(db, principal, slug, id, rev, now) : doc.data;
  const html = key ? data[key] : undefined;
  if (typeof html !== 'string' || !html.trim()) throw new NotFoundError('Page');

  const name = fileNameOf(titleOf(def, doc), doc.id);
  return c.body(html, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="${past ? name.replace(/\.html$/, `-v${rev}.html`) : name}"`,
    'Cache-Control': 'private, no-store',
  });
});
