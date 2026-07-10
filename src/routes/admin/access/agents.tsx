import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { createAgent } from '@/services/access';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/access/agents — create a new machine principal (Service or Agent). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const subtype = String(body.subtype ?? 'agent') === 'service' ? 'service' : 'agent';
  await createAgent(
    getDb(c.env.DB),
    requirePrincipal(c),
    String(body.name ?? ''),
    nowIso(),
    subtype,
  );
  return c.redirect('/admin/access', 303);
});
