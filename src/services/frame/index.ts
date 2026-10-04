/**
 * The frame service (D60) — the two halves of showing a `renderMode: 'frame'`
 * document: the viewer shell MINTS a ticket naming who is looking, and the
 * content route READS the document back through it.
 *
 * The ticket carries identity, never access (`@/lib/frame/ticket`): the read
 * here rebuilds the principal the ticket names and goes through `getDocument`
 * — the ordinary `authorize()` pipeline, audit row included. No content is
 * ever read on the strength of the ticket alone.
 */

import type { Database } from '@/db/client';
import { anonymousPrincipal, type Principal } from '@/access';
import { getDocumentCollection } from '@/db/queries/documents';
import { getDocument, getRevisionData } from '@/services/documents';
import { getCollectionOrThrow } from '@/services/collections';
import { signFrameTicket, verifyFrameTicket, type FrameViewer } from '@/lib/frame/ticket';
import { framePageHtml, prepareFramedDocument } from '@/lib/frame/document';
import { NotFoundError } from '@/lib/errors';

/** The ticket viewer for the principal a shell just authorized a read with. */
export function frameViewerOf(principal: Principal): FrameViewer {
  if (principal.linkId) return { kind: 'link', id: principal.linkId };
  if (principal.id === 'anonymous') return { kind: 'anonymous' };
  return { kind: 'principal', id: principal.id };
}

/** The principal a ticket names — the same shapes the shells authorize with: a
 *  session user (`principalFromSession`), a share-link reader
 *  (`getSharedDocument`), or plain anonymous. */
function principalOf(viewer: FrameViewer): Principal {
  if (viewer.kind === 'principal') return { id: viewer.id, kind: 'user', surface: 'admin' };
  if (viewer.kind === 'link') return { ...anonymousPrincipal('rest'), linkId: viewer.id };
  return anonymousPrincipal('rest');
}

/**
 * The iframe `src` for a document the caller has ALREADY read as `principal`.
 * `revision` 0 (the default) frames the current revision; a past revision is
 * re-checked for `update` when the ticket is redeemed.
 */
export async function mintFrameSrc(
  secret: string,
  principal: Principal,
  documentId: string,
  now: string,
  revision = 0,
): Promise<string> {
  const ticket = await signFrameTicket(
    secret,
    { documentId, revision, viewer: frameViewerOf(principal) },
    now,
  );
  return `/frame/${ticket}`;
}

/**
 * Redeem a ticket for the servable framed document. Throws `NotFoundError` for
 * a bad or expired ticket, a missing document, and a collection that is not
 * (or no longer) frame-mode; a viewer who has lost access surfaces as
 * `ForbiddenError` from `authorize()`. The route folds all of them into one
 * indistinguishable 404.
 */
export async function readFramedDocument(
  db: Database,
  secret: string,
  ticket: string,
  now: string,
): Promise<string> {
  const claims = await verifyFrameTicket(secret, ticket, now);
  if (!claims) throw new NotFoundError('Page');
  const collection = await getDocumentCollection(db, claims.documentId);
  if (!collection) throw new NotFoundError('Page');

  const principal = principalOf(claims.viewer);
  const doc = await getDocument(db, principal, collection, claims.documentId, now);
  const def = await getCollectionOrThrow(db, collection);
  const data =
    claims.revision === 0 || claims.revision === doc.revision
      ? doc.data
      : await getRevisionData(db, principal, collection, claims.documentId, claims.revision, now);
  const html = framePageHtml(def, data);
  if (html === null) throw new NotFoundError('Page');
  return prepareFramedDocument(html);
}
