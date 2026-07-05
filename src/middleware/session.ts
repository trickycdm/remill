/**
 * Session middleware for Cloudflare Workers + hono-sessions. Uses CookieStore
 * (encrypted cookie), so no external session store is needed. The encryption key
 * is the per-request `SESSION_SECRET` binding, so we build the underlying
 * hono-sessions middleware once per request. SESSION_SECRET must be >= 32 chars.
 */

import { sessionMiddleware, CookieStore } from 'hono-sessions';
import { createMiddleware } from 'hono/factory';
import type { Env } from '@/types';

/**
 * Hono middleware that initialises an encrypted cookie session. Apply before any
 * route that reads or writes session data.
 */
export function sessionSetup() {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const secret = c.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters long');
    }

    const store = new CookieStore();

    const middleware = sessionMiddleware({
      store,
      encryptionKey: secret,
      expireAfterSeconds: 86400, // 24 hours
      cookieOptions: {
        sameSite: 'Lax',
        path: '/',
        httpOnly: true,
        secure: true,
      },
    });

    return middleware(c, next);
  });
}
