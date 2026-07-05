import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { createAgent } from '@/services/access';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/access/agents — create a new agent principal. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  await createAgent(getDb(c.env.DB), requirePrincipal(c), String(body.name ?? ''), nowIso());
  return c.redirect('/admin/access', 303);
});
