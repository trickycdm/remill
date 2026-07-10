import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listPackStatuses } from '@/services/collections';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/packs — the content-pack registry with installed status (discovery;
 *  ungated — `installed` reveals nothing GET /api/collections doesn't). */
export const onRequestGet = factory.createHandlers(async (c) => {
  return apiJson(c, { data: await listPackStatuses(getDb(c.env.DB)) });
});
