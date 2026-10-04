/**
 * POST /admin/login/passkey/verify — finish a passkey sign-in (D58). On success
 * it starts the SAME session a password login does and tells the island where to
 * go; on any failure it answers one generic message (never which check failed).
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { finishAuthentication } from '@/services/passkeys';
import { setSessionUser } from '@/lib/auth';
import { ForbiddenError } from '@/lib/errors';
import { passkeyJson } from '@/lib/passkey-http';
import { safeRedirect } from '@/lib/safe-redirect';
import { rateLimit, LOGIN_RATE_LIMIT } from '@/middleware/rate-limit';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(rateLimit('passkey-verify', LOGIN_RATE_LIMIT), (c) =>
  passkeyJson(c, async ({ db, rp, now, body }) => {
    const user = await finishAuthentication(db, rp, body.response, now);
    // 403, not 401: a 401 answer to a POST with a body is a network error under
    // the fetch spec's auth-retry rule, which the local Workers proxy enforces.
    if (!user) throw new ForbiddenError('That passkey could not be used to sign in.');
    setSessionUser(c, user);
    return { redirect: safeRedirect(typeof body.redirect === 'string' ? body.redirect : undefined) };
  }),
);
