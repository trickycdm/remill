import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { getDb } from '@/db/client';
import { resolveShareLink } from '@/services/access';
import { getSharedDocument, getBacklinks } from '@/services/documents';
import { anonymousPrincipal } from '@/access';
import { getSettings } from '@/services/settings';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';
import { PublicShell, PublicNotFound } from '@/components/layouts/public-shell';
import { DocumentView } from '@/components/document-view';

const factory = createFactory<{ Bindings: Env }>();

/**
 * GET /s/:token — consume a SHARE LINK (C3). The token resolves to an
 * item_grants row (subjectKind 'link'); the read then runs through the same
 * `authorize()` machinery as everything else, with the link identity carried on
 * an anonymous principal. Unknown, expired, and revoked tokens — and grants
 * without `read` — all render ONE indistinguishable 404. An `Accept:
 * application/json` request gets the document as JSON instead of HTML.
 */
export const onRequestGet = factory.createHandlers(async (c) => {
  const db = getDb(c.env.DB);
  const now = nowIso();
  const settings = await getSettings(db);
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');

  const notFound = () => {
    if (wantsJson) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    c.status(404);
    return c.render(
      <PublicShell settings={settings}>
        <PublicNotFound />
      </PublicShell>,
    );
  };

  const grant = await resolveShareLink(db, pathParam(c, 'token'), now);
  if (!grant) return notFound();

  try {
    const { doc, def } = await getSharedDocument(db, grant, now);
    if (wantsJson) return c.json({ data: doc });
    // Backlinks stay access-scoped: the link grants ONE document, so referrers
    // only appear when they're independently public.
    const backlinks = await getBacklinks(
      db,
      { ...anonymousPrincipal('rest'), linkId: grant.subjectId },
      doc.collection,
      doc.id,
      now,
    );
    return c.render(
      <PublicShell settings={settings}>
        <DocumentView def={def} doc={doc} backlinks={backlinks} surface="public" />
      </PublicShell>,
    );
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) return notFound();
    throw e;
  }
});
