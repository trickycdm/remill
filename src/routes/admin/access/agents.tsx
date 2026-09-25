import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { deleteAgent, renameAgent, setAgentDisabled } from '@/services/access';
import { dsRedirect } from '@/lib/datastar-response';
import { nowIso } from '@/lib/now';
import { InputValidationError } from '@/lib/errors';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /admin/access/agents — rename, disable, enable, or delete a machine
 * principal (op field). A Datastar form action, so a refused delete (the agent
 * authored content) or an invalid name surfaces through onError's dsError
 * instead of a raw JSON error.
 */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const principalId = String(body.principalId ?? '');
  const op = String(body.op ?? '');
  const now = nowIso();

  if (op === 'delete') await deleteAgent(db, principal, principalId, now);
  else if (op === 'rename') await renameAgent(db, principal, principalId, String(body.name ?? ''), now);
  else if (op === 'disable' || op === 'enable') await setAgentDisabled(db, principal, principalId, op === 'disable', now);
  else throw new InputValidationError([{ path: 'op', message: `Unknown operation '${op}'.` }]);

  return dsRedirect(c, '/admin/access');
});
