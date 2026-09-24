import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { describeSelf } from '@/services/access';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/me — the caller's own identity, roles, resolved permissions, token
 *  scope and OAuth client (REST parity for MCP `whoami`). Identity-scoped: it
 *  reveals only what the caller already holds. */
export const onRequestGet = factory.createHandlers(async (c) => {
  const principal = await apiPrincipal(c, nowIso());
  return apiJson(c, { data: await describeSelf(getDb(c.env.DB), principal) });
});
