import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiJson, apiPrincipal } from '@/lib/api';
import { getDb } from '@/db/client';
import { listPackStatuses } from '@/services/collections';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/packs — the content-pack registry with installed status (discovery;
 *  ungated, but `installed` is caller-scoped since D46 so it reveals nothing
 *  GET /api/collections doesn't). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const principal = await apiPrincipal(c, nowIso());
  return apiJson(c, { data: await listPackStatuses(getDb(c.env.DB), principal) });
});
