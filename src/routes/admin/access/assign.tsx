import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { assignRole, unassignRole } from '@/services/access';
import { nowIso } from '@/lib/now';
import { principalHref } from '@/components/admin/principal-display';

const factory = createFactory<{ Bindings: Env }>();

/** POST /admin/access/assign — assign or unassign a role (op field). */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody();
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const targetPrincipalId = String(body.principalId ?? '');
  const role = String(body.role ?? '');
  const collection = String(body.collection ?? '*') || '*';
  const now = nowIso();

  if (String(body.op) === 'unassign') {
    await unassignRole(db, principal, targetPrincipalId, role, collection, now);
  } else {
    await assignRole(db, principal, targetPrincipalId, role, collection, now);
  }
  return c.redirect(principalHref(targetPrincipalId), 303);
});
