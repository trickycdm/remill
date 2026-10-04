/**
 * POST /admin/account/passkeys — finish adding a passkey to the signed-in human's
 * OWN account (D58): verify the browser's response against the challenge issued
 * to this principal and store the public key.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { finishRegistration } from '@/services/passkeys';
import { passkeyJson } from '@/lib/passkey-http';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(requireAuth(), (c) =>
  passkeyJson(c, async ({ db, rp, now, body }) => {
    await finishRegistration(
      db,
      rp,
      getUser(c).id,
      { response: body.response, name: String(body.name ?? '') },
      now,
    );
    return { redirect: '/admin/account' };
  }),
);
