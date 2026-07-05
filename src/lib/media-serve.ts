/**
 * Stream a media object from R2 with HTTP range support (so video/audio seeking
 * works) and immutable caching (MEDIA_STANDARDS.md). Content-Type is the STORED
 * sniffed mime, never anything derived from the request.
 */

import type { Context } from 'hono';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { getMediaForServe } from '@/services/media';
import { principalFromSession } from '@/access';
import { getSessionUser } from '@/lib/auth';
import { nowIso } from '@/lib/now';
import type { Principal } from '@/access';

const ANONYMOUS: Principal = { id: 'anonymous', kind: 'user', surface: 'admin' };

/** Parse a single `bytes=start-end` range against a known size, or null. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  let start: number;
  let end: number;
  if (hasStart) {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : size - 1;
  } else if (hasEnd) {
    // suffix range: last N bytes
    const n = parseInt(m[2], 10);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    return null;
  }
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function serveMedia(c: Context<{ Bindings: Env }>, id: string): Promise<Response> {
  const db = getDb(c.env.DB);
  const user = getSessionUser(c);
  const principal = user ? principalFromSession(user) : ANONYMOUS;
  const rec = await getMediaForServe(db, principal, id, nowIso());

  const cacheHeaders: Record<string, string> = {
    'Content-Type': rec.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${rec.id}"`,
    'Accept-Ranges': 'bytes',
  };

  // Conditional GET.
  if (c.req.header('If-None-Match') === `"${rec.id}"`) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  const range = parseRange(c.req.header('Range'), rec.size);
  if (range) {
    const obj = await c.env.MEDIA.get(rec.r2Key, {
      range: { offset: range.start, length: range.end - range.start + 1 },
    });
    if (!obj) return c.notFound();
    return new Response(obj.body, {
      status: 206,
      headers: {
        ...cacheHeaders,
        'Content-Range': `bytes ${range.start}-${range.end}/${rec.size}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  }

  const obj = await c.env.MEDIA.get(rec.r2Key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    status: 200,
    headers: { ...cacheHeaders, 'Content-Length': String(rec.size) },
  });
}
