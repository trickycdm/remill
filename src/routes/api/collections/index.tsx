import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listCollections, createCollection } from '@/services/collections';
import type { CollectionDefinition } from '@/fields/types';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/collections — list collection definitions (metadata). */
export const onRequestGet = factory.createHandlers(async (c) => {
  return apiJson(c, { data: await listCollections(getDb(c.env.DB)) });
});

/** POST /api/collections — create a collection (requires manage_schema). */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const def = await createCollection(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    (await jsonBody(c)) as unknown as CollectionDefinition,
    now,
  );
  return apiJson(c, { data: def }, 201);
});
