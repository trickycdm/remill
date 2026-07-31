import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { nowIso } from '@/lib/now';
import { startDeviceAuthorization } from '@/services/oauth';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { rateLimit, TOKEN_RATE_LIMIT } from '@/middleware/rate-limit';
import { oauthErrorBody } from '@/lib/oauth';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /oauth/device-authorization — RFC 8628 §3.1 (D48): start a headless
 * pairing. The client must already be registered (DCR); the human enters the
 * returned user_code at /oauth/device. Raw OAuth JSON responses.
 */
export const onRequestPost = factory.createHandlers(
  rateLimit('oauth-device-start', TOKEN_RATE_LIMIT),
  async (c) => {
    const db = getDb(c.env.DB);
    let clientId = '';
    let resource: string | null = null;
    try {
      const form = await c.req.parseBody();
      if (typeof form.client_id === 'string') clientId = form.client_id;
      if (typeof form.resource === 'string') resource = form.resource;
    } catch {
      return c.json(oauthErrorBody('invalid_request', 'Body must be form-encoded.'), 400);
    }
    const baseUrl = resolveBaseUrl(c.env, await getSettings(db), c.req.url);
    const result = await startDeviceAuthorization(db, { clientId, resource }, baseUrl, nowIso());
    if (!result.ok) {
      return c.json(oauthErrorBody(result.error, result.description), result.error === 'invalid_client' ? 401 : 400);
    }
    c.header('Cache-Control', 'no-store');
    return c.json(result.body);
  },
);
