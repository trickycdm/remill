import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { uploadMedia } from '@/services/media';
import { rateLimit, UPLOAD_RATE_LIMIT } from '@/middleware/rate-limit';
import { nowIso } from '@/lib/now';
import { BadRequestError } from '@/lib/errors';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/media/upload — multipart upload → sniff → R2 → metadata row. */
export const onRequestPost = factory.createHandlers(rateLimit('upload', UPLOAD_RATE_LIMIT), requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new BadRequestError('No file provided.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  await uploadMedia(
    getDb(c.env.DB),
    c.env.MEDIA,
    requirePrincipal(c),
    { filename: file.name, bytes, alt: typeof body.alt === 'string' ? body.alt : undefined },
    nowIso(),
  );
  return c.redirect('/admin/media', 303);
});
