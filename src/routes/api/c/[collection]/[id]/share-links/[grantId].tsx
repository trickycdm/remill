import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { revokeShareLink } from '@/services/access';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** DELETE /api/c/:collection/:id/share-links/:grantId — revoke a share link. */
export const onRequestDelete = factory.createHandlers(async (c) => {
  const now = nowIso();
  await revokeShareLink(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    pathParam(c, 'grantId'),
    now,
  );
  return apiJson(c, { data: { ok: true } });
});
