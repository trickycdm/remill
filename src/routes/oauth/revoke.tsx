import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { revokeOAuthToken } from '@/services/oauth';
import { rateLimit, OAUTH_TOKEN_RATE_LIMIT } from '@/middleware/rate-limit';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /oauth/revoke — RFC 7009 (D48). claude.ai calls this when a connector
 * is disconnected. Always 200 with an empty body: revocation of an unknown or
 * already-dead token is indistinguishable from success (no enumeration
 * oracle). A refresh token kills its grant's whole chain; an access token
 * dies alone.
 */
export const onRequestPost = factory.createHandlers(
  rateLimit('oauth-token', OAUTH_TOKEN_RATE_LIMIT),
  async (c) => {
    let token = '';
    try {
      const form = await c.req.parseBody();
      if (typeof form.token === 'string') token = form.token;
    } catch {
      // Malformed body → still 200 per RFC 7009's forgiving posture.
    }
    await revokeOAuthToken(getDb(c.env.DB), token);
    return c.body(null, 200);
  },
);
