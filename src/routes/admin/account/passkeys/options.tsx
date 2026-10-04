/**
 * POST /admin/account/passkeys/options — start adding a passkey to the signed-in
 * human's OWN account (D58). Re-checks the current password before issuing the
 * options for `navigator.credentials.create()`. Rate-limited per person. Scoped
 * strictly to the session principal (`getUser(c).id`) — never a body id.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { beginRegistration } from '@/services/passkeys';
import { passkeyJson } from '@/lib/passkey-http';
import { consumeRateLimit, LOGIN_RATE_LIMIT } from '@/middleware/rate-limit';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireAuth(), (c) =>
  passkeyJson(c, async ({ db, rp, now, body }) => {
    const principalId = getUser(c).id;
    // This step checks the current password, so it is limited like a login —
    // per PERSON, not per IP: the caller already holds a session.
    await consumeRateLimit(c.env.RATE_LIMIT, 'passkey-register', LOGIN_RATE_LIMIT, principalId);
    return beginRegistration(
      db,
      rp,
      principalId,
      { currentPassword: String(body.currentPassword ?? ''), name: String(body.name ?? '') },
      now,
    );
  }),
);
