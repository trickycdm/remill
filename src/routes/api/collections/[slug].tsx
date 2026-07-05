import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { getCollection, updateCollection } from '@/services/collections';
import type { CollectionDefinition } from '@/fields/types';
import { nowIso } from '@/lib/now';
import { NotFoundError } from '@/lib/errors';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/collections/:slug — one collection definition. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const def = await getCollection(getDb(c.env.DB), pathParam(c, 'slug'));
  if (!def) throw new NotFoundError('Collection');
  return apiJson(c, { data: def });
});

/** PATCH /api/collections/:slug — modify a collection (requires manage_schema). */
export const onRequestPatch = factory.createHandlers(async (c) => {
  const now = nowIso();
  const slug = pathParam(c, 'slug');
  const def = await updateCollection(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    slug,
    (await jsonBody(c)) as unknown as CollectionDefinition,
    now,
  );
  return apiJson(c, { data: def });
});
