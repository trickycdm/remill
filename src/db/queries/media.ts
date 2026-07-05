/**
 * Media metadata queries. The `media` table is the store of record for uploaded
 * assets (bytes live in R2); it carries binary + fixed columns that don't fit the
 * documents pipeline, so media has a dedicated store (see MEDIA_STANDARDS.md).
 */

import { eq, desc, like, count } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { media, documents } from '@/db/schema';

export interface MediaRecord {
  readonly id: string;
  readonly r2Key: string;
  readonly filename: string;
  readonly mime: string;
  readonly size: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly alt: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

function toDomain(r: typeof media.$inferSelect): MediaRecord {
  return {
    id: r.id,
    r2Key: r.r2Key,
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    width: r.width,
    height: r.height,
    duration: r.duration,
    alt: r.alt,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export async function insertMedia(
  db: Database,
  rec: Omit<MediaRecord, 'createdAt'> & { now: string },
): Promise<void> {
  await db.insert(media).values({
    id: rec.id,
    r2Key: rec.r2Key,
    filename: rec.filename,
    mime: rec.mime,
    size: rec.size,
    width: rec.width,
    height: rec.height,
    duration: rec.duration,
    alt: rec.alt,
    variantsJson: null,
    createdBy: rec.createdBy,
    createdAt: rec.now,
  });
}

export async function getMedia(db: Database, id: string): Promise<MediaRecord | null> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function listMedia(
  db: Database,
  opts: { limit: number; offset: number },
): Promise<{ rows: MediaRecord[]; total: number }> {
  const rows = await db
    .select()
    .from(media)
    .orderBy(desc(media.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const totalRows = await db.select({ n: count() }).from(media);
  return { rows: rows.map(toDomain), total: totalRows[0]?.n ?? 0 };
}

export async function updateMediaAlt(db: Database, id: string, alt: string): Promise<void> {
  await db.update(media).set({ alt }).where(eq(media.id, id));
}

export async function deleteMedia(db: Database, id: string): Promise<void> {
  await db.delete(media).where(eq(media.id, id));
}

/** How many documents reference this media id (crude JSON scan — the block-on-
 *  delete guard, MEDIA_STANDARDS.md). Fine at lightweight scale. */
export async function countMediaReferences(db: Database, id: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(documents)
    .where(like(documents.dataJson, `%${id}%`));
  return rows[0]?.n ?? 0;
}
