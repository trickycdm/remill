import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { nowIso } from '@/lib/now';
import { registerClient } from '@/services/oauth';
import { rateLimit, OAUTH_REGISTER_RATE_LIMIT } from '@/middleware/rate-limit';
import { oauthErrorBody } from '@/lib/oauth';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /oauth/register — RFC 7591 dynamic client registration (D48). Public
 * clients only; unauthenticated by design, so tightly rate-limited and pruned
 * by the daily cron when a registration never reaches a consented grant.
 * Responses are raw OAuth JSON (never the app error shape).
 */
export const onRequestPost = factory.createHandlers(
  rateLimit('oauth-register', OAUTH_REGISTER_RATE_LIMIT),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(oauthErrorBody('invalid_client_metadata', 'Request body must be JSON.'), 400);
    }
    const result = await registerClient(getDb(c.env.DB), body, nowIso());
    if (!result.ok) return c.json(oauthErrorBody(result.error, result.description), 400);
    return c.json(result.body, 201);
  },
);
