/**
 * Media metadata queries. The `media` table is the store of record for uploaded
 * assets (bytes live in R2); it carries binary + fixed columns that don't fit the
 * documents pipeline, so media has a dedicated store (see MEDIA_STANDARDS.md).
 */

import { eq, desc, like, count, and, or, lt } from 'drizzle-orm';
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

/** An opaque forward cursor: the (createdAt, id) of the last row of a page. `id`
 *  breaks ties on identical timestamps (nanoids are not time-ordered). */
export interface MediaPage {
  readonly rows: MediaRecord[];
  readonly total: number;
  /** Cursor to fetch the next page, or null when the last page was returned. */
  readonly nextCursor: string | null;
}

function encodeCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`; // createdAt is ISO and id is a nanoid — neither holds '|'
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const i = cursor.indexOf('|');
  if (i < 0) return null;
  return { createdAt: cursor.slice(0, i), id: cursor.slice(i + 1) };
}

/**
 * Keyset (cursor) pagination over `media`, newest first. Replaces OFFSET, whose
 * cost grows with the skipped-row count and which can skip/duplicate rows under
 * concurrent inserts (COR-7/TD-9). Ordered by (createdAt DESC, id DESC); the cursor
 * is the last row of the previous page.
 */
export async function listMedia(db: Database, opts: { limit: number; cursor?: string | null }): Promise<MediaPage> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
  const where = decoded
    ? or(
        lt(media.createdAt, decoded.createdAt),
        and(eq(media.createdAt, decoded.createdAt), lt(media.id, decoded.id)),
      )
    : undefined;

  // Over-fetch by one to detect whether a further page exists.
  const fetched = await db
    .select()
    .from(media)
    .where(where)
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(opts.limit + 1);

  const hasMore = fetched.length > opts.limit;
  const page = hasMore ? fetched.slice(0, opts.limit) : fetched;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  const totalRows = await db.select({ n: count() }).from(media);
  return { rows: page.map(toDomain), total: totalRows[0]?.n ?? 0, nextCursor };
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
