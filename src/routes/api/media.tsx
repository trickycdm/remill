import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { uploadMedia } from '@/services/media';
import { rateLimit, UPLOAD_RATE_LIMIT } from '@/middleware/rate-limit';
import { nowIso } from '@/lib/now';
import { BadRequestError } from '@/lib/errors';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/media — multipart upload → sniff → R2 → metadata (scope: write). */
export const onRequestPost = factory.createHandlers(
  rateLimit('upload', UPLOAD_RATE_LIMIT),
  async (c) => {
    const now = nowIso();
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new BadRequestError('multipart field "file" is required.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const rec = await uploadMedia(
      getDb(c.env.DB),
      c.env.MEDIA,
      await apiPrincipal(c, now),
      { filename: file.name, bytes, alt: typeof body.alt === 'string' ? body.alt : undefined },
      now,
    );
    return apiJson(c, { data: { ...rec, url: `/media/${rec.id}` } }, 201);
  },
);
