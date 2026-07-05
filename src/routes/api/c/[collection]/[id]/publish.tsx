import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { setPublished } from '@/services/documents';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/c/:collection/:id/publish — publish or unpublish (`{ "publish": bool }`). */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = await jsonBody(c).catch(() => ({ publish: true }));
  const publish = body.publish !== false;
  const doc = await setPublished(getDb(c.env.DB), await apiPrincipal(c, now), pathParam(c, 'collection'), pathParam(c, 'id'), publish, now);
  return apiJson(c, { data: doc });
});
