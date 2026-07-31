import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listCollectionsForDiscovery, createCollection } from '@/services/collections';
import type { CollectionDefinition } from '@/fields/types';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/collections — list collection definitions. Discovery is public, but
 *  unauthenticated/unprivileged callers get the public-safe projection (SEC-5). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const principal = await apiPrincipal(c, now);
  return apiJson(c, { data: await listCollectionsForDiscovery(getDb(c.env.DB), principal) });
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
