import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listAuditPage } from '@/services/access';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/audit — the queryable audit trail (manage_access-gated in the
 *  service). Filters: ?principal, ?action, ?collection, ?result=allow|deny,
 *  ?surface; keyset pagination via ?cursor from a prior response. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const q = c.req.query();
  const page = await listAuditPage(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    {
      filters: {
        principalId: q.principal || undefined,
        action: q.action || undefined,
        collection: q.collection || undefined,
        allowed: q.result === 'allow' ? true : q.result === 'deny' ? false : undefined,
        surface: q.surface || undefined,
      },
      cursor: q.cursor || undefined,
      limit: Number(q.limit) || undefined,
    },
    now,
  );
  return apiJson(c, { data: page.rows, limit: page.limit, nextCursor: page.nextCursor });
});
