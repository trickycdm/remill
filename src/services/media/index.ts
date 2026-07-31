/**
 * Media service — upload, serve-metadata, list, alt, delete. Upload is `create` on
 * the `media` collection; read is `read` on it (so publicRead applies) — one
 * authorization pipeline, no parallel media ACL (steering/MEDIA_STANDARDS.md).
 *
 * The bytes stream to R2; the row records the SNIFFED mime (never the client's
 * claim) and cheap-to-extract dimensions. Images require alt text (WCAG 2.1 AA).
 */

import type { Database } from '@/db/client';
import { authorize, type Principal } from '@/access';
import * as mq from '@/db/queries/media';
import { sniffMime, SNIFF_BYTES } from '@/lib/mime';
import { imageSize } from '@/lib/image-size';
import { newId } from '@/lib/id';
import { clampPageSize } from '@/lib/list-query';
import { BadRequestError, InputValidationError, NotFoundError, ConflictError } from '@/lib/errors';

export type { MediaRecord } from '@/db/queries/media';

const MEDIA_COLLECTION = 'media';
/** Max size accepted through the single-request upload path (25 MB). Larger media
 *  should use client-driven R2 multipart (MEDIA_STANDARDS.md) — Phase 5 backlog. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(0, 120) || 'file';
}

/** Upload bytes: authorize, sniff, validate, store to R2, record metadata. */
export async function uploadMedia(
  db: Database,
  bucket: R2Bucket,
  principal: Principal,
  input: { filename: string; bytes: Uint8Array; alt?: string },
  now: string,
): Promise<mq.MediaRecord> {
  await authorize(db, principal, 'create', { collection: MEDIA_COLLECTION }, now);

  if (input.bytes.byteLength === 0) throw new BadRequestError('Empty file.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new BadRequestError(`File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit.`);
  }

  // Sniff the actual bytes — never trust the extension/declared type.
  const sniff = sniffMime(input.bytes.subarray(0, SNIFF_BYTES));
  if (!sniff) throw new BadRequestError('Unsupported or unrecognized file type.');

  // Alt text is required for images (WCAG 2.1 AA).
  if (sniff.kind === 'image' && !input.alt?.trim()) {
    throw new InputValidationError([{ path: 'alt', message: 'Alt text is required for images.' }]);
  }

  const id = newId('media');
  const filename = sanitizeFilename(input.filename);
  const r2Key = `media/${id}/${filename}`;
  const dims = sniff.kind === 'image' ? imageSize(input.bytes, sniff.mime) : null;

  await bucket.put(r2Key, input.bytes, { httpMetadata: { contentType: sniff.mime } });

  // Build the record once and insert it — no re-fetch round-trip (TD-9). The row we
  // write is exactly the row we return.
  const record: mq.MediaRecord = {
    id,
    r2Key,
    filename,
    mime: sniff.mime,
    size: input.bytes.byteLength,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    duration: null,
    alt: input.alt?.trim() ?? null,
    createdBy: principal.id,
    createdAt: now,
  };
  await mq.insertMedia(db, {
    ...record,
    now,
    event: { type: 'media.created', collection: MEDIA_COLLECTION, resource: id, principalId: principal.id, at: now },
  });
  return record;
}

/**
 * Read one media record by id, authorized as `read` of PUBLISHED media on the
 * `media` collection (so publicRead lets anonymous fetch assets, and drafts stay
 * hidden). The single Grant-gated read path shared by media serving and the MCP
 * `get_media_url` tool (COR-6 — that tool previously read media with no authz).
 */
export async function getMediaById(
  db: Database,
  principal: Principal,
  id: string,
  now: string,
): Promise<mq.MediaRecord> {
  await authorize(db, principal, 'read', { collection: MEDIA_COLLECTION, documentId: id, status: 'published' }, now);
  const rec = await mq.getMedia(db, id);
  if (!rec) throw new NotFoundError('Media');
  return rec;
}

/** Resolve a media row for serving (alias of the Grant-gated read). */
export async function getMediaForServe(
  db: Database,
  principal: Principal,
  id: string,
  now: string,
): Promise<mq.MediaRecord> {
  return getMediaById(db, principal, id, now);
}

export async function listMedia(
  db: Database,
  principal: Principal,
  opts: { limit?: number; cursor?: string | null },
  now: string,
) {
  await authorize(db, principal, 'read', { collection: MEDIA_COLLECTION }, now);
  const limit = clampPageSize(opts.limit);
  const { rows, total, nextCursor } = await mq.listMedia(db, { limit, cursor: opts.cursor ?? null });
  return { rows, total, nextCursor };
}

export async function updateAlt(db: Database, principal: Principal, id: string, alt: string, now: string): Promise<void> {
  await authorize(db, principal, 'update', { collection: MEDIA_COLLECTION, documentId: id }, now);
  await mq.updateMediaAlt(db, id, alt);
}

/** Delete media — blocked while any document references it (MEDIA_STANDARDS.md). */
export async function deleteMedia(
  db: Database,
  bucket: R2Bucket,
  principal: Principal,
  id: string,
  now: string,
): Promise<void> {
  await authorize(db, principal, 'delete', { collection: MEDIA_COLLECTION, documentId: id }, now);
  const rec = await mq.getMedia(db, id);
  if (!rec) throw new NotFoundError('Media');
  const refs = await mq.countMediaReferences(db, id);
  if (refs > 0) throw new ConflictError(`This media is used by ${refs} document(s). Remove those references first.`);
  await mq.deleteMedia(db, id, {
    type: 'media.deleted',
    collection: MEDIA_COLLECTION,
    resource: id,
    principalId: principal.id,
    at: now,
  }); // row (+event) first…
  await bucket.delete(rec.r2Key); // …then the object (tolerates re-run)
}
