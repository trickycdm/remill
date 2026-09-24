import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { deleteAgent, setAgentDisabled } from '@/services/access';
import { dsRedirect } from '@/lib/datastar-response';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /admin/access/agents — disable, enable, or delete a machine principal
 * (op field). A Datastar form action, so a refused delete (the agent authored
 * content) surfaces through onError's dsError instead of a raw JSON 409.
 */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const principalId = String(body.principalId ?? '');
  const op = String(body.op ?? '');
  const now = nowIso();

  if (op === 'delete') await deleteAgent(db, principal, principalId, now);
  else await setAgentDisabled(db, principal, principalId, op === 'disable', now);

  return dsRedirect(c, '/admin/access');
});
