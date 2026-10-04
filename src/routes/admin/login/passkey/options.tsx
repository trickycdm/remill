/**
 * POST /admin/login/passkey/options — start a passkey sign-in (D58). Returns the
 * options for `navigator.credentials.get()`. Names no account, so it reveals
 * nothing about who has a passkey. Rate-limited on its own bucket: the login page
 * asks for options on every load (to offer passkeys in autofill), and those page
 * views must not eat into the sign-in attempts the verify step allows.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { beginAuthentication } from '@/services/passkeys';
import { passkeyJson } from '@/lib/passkey-http';
import { rateLimit, LOGIN_RATE_LIMIT } from '@/middleware/rate-limit';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestPost = factory.createHandlers(rateLimit('passkey-options', LOGIN_RATE_LIMIT), (c) =>
  passkeyJson(c, ({ db, rp, now }) => beginAuthentication(db, rp, now)),
);
