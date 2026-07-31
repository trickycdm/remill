/**
 * Resolve the admin request's authenticated human into an access-control
 * Principal (surface = 'admin'). Routes call this after requireAuth, then hand the
 * Principal to services — which run it through authorize() (ACCESS_CONTROL.md).
 */

import type { Context } from 'hono';
import { getUser } from '@/lib/auth';
import { principalFromSession, type Principal } from '@/access';

export function requirePrincipal(c: Context): Principal {
  return principalFromSession(getUser(c));
}
