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

  await mq.insertMedia(db, {
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
    now,
  });

  return (await mq.getMedia(db, id))!;
}

/** Resolve a media row for serving. Read authorized as published media of the
 *  `media` collection (so publicRead lets anonymous fetch assets). */
export async function getMediaForServe(
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

export async function listMedia(db: Database, principal: Principal, opts: { page?: number; pageSize?: number }, now: string) {
  await authorize(db, principal, 'read', { collection: MEDIA_COLLECTION }, now);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, opts.pageSize ?? 24));
  const { rows, total } = await mq.listMedia(db, { limit: pageSize, offset: (page - 1) * pageSize });
  return { rows, total, page, pageSize };
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
  await mq.deleteMedia(db, id); // row first…
  await bucket.delete(rec.r2Key); // …then the object (tolerates re-run)
}
