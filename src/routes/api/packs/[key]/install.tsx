import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { installPack } from '@/services/collections';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/packs/:key/install — create the pack's collection(s) through the
 *  standard pipeline (requires manage_schema; the service authorizes). Body is
 *  optional: `{ "slug": "essays" }` renames a single-collection pack's scaffold.
 *  409 when a target collection already exists. */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const principal = await apiPrincipal(c, now);
  const body = (await jsonBody(c).catch(() => ({}))) as { slug?: unknown };
  const created = await installPack(
    getDb(c.env.DB),
    principal,
    c.req.param('key') ?? '',
    now,
    typeof body.slug === 'string' ? { slug: body.slug } : undefined,
  );
  return apiJson(c, { data: created }, 201);
});
