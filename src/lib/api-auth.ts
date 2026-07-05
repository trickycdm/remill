/**
 * Resolve the acting principal for a REST/MCP request from its bearer token
 * (steering/API_AND_MCP_STANDARDS.md). No token → the `anonymous` principal.
 * The token's scope mask is carried on the principal so authorize() can narrow.
 * Tokens are looked up by SHA-256 hash; expired tokens and disabled principals
 * are rejected.
 */

import type { Context } from 'hono';
import type { Database } from '@/db/client';
import { findTokenByHash, isPrincipalActive } from '@/db/queries/principals';
import { hashToken } from '@/lib/token';
import { UnauthorizedError } from '@/lib/errors';
import type { Action, Principal, Surface } from '@/access';

export const ANONYMOUS_PRINCIPAL: Principal = { id: 'anonymous', kind: 'user', surface: 'rest' };

function bearer(c: Context): string | null {
  const h = c.req.header('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Resolve the principal for this request. `surface` is 'rest' or 'mcp' (for audit
 * attribution). Throws 401 on an invalid/expired token; returns the anonymous
 * principal when no token is presented.
 */
export async function resolvePrincipal(
  db: Database,
  c: Context,
  surface: Surface,
  now: string,
): Promise<Principal> {
  const token = bearer(c);
  if (!token) return { ...ANONYMOUS_PRINCIPAL, surface };

  const rec = await findTokenByHash(db, await hashToken(token), now);
  if (!rec) throw new UnauthorizedError('Invalid token.');
  if (rec.expiresAt && rec.expiresAt <= now) throw new UnauthorizedError('Token expired.');
  if (!(await isPrincipalActive(db, rec.principalId))) throw new UnauthorizedError('Principal disabled.');

  return {
    id: rec.principalId,
    kind: 'agent',
    surface,
    tokenId: rec.id,
    tokenScope: rec.scope
      ? rec.scope.map((s) => ({ collection: s.collection, action: s.action as Action }))
      : undefined,
  };
}
