import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { nowIso } from '@/lib/now';
import {
  exchangeAuthorizationCode,
  refreshGrant,
  exchangeDeviceCode,
  type TokenResult,
} from '@/services/oauth';
import { rateLimit, OAUTH_TOKEN_RATE_LIMIT } from '@/middleware/rate-limit';
import { oauthErrorBody } from '@/lib/oauth';

const factory = createFactory<{ Bindings: Env }>();

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * POST /oauth/token — the OAuth 2.1 token endpoint (D48): authorization_code
 * (+PKCE), refresh_token (rotating), and the RFC 8628 device grant. Every
 * outcome — including errors — is raw OAuth JSON via early returns, because
 * clients branch on `error` values (`authorization_pending`, `slow_down`,
 * `invalid_grant`); nothing here may throw through the global onError
 * (ERROR_HANDLING.md exception, documented in D48). Tokens minted here are
 * credential RE-DERIVATION inside a consented grant — never a privilege
 * decision (SEC-8).
 */
export const onRequestPost = factory.createHandlers(
  rateLimit('oauth-token', OAUTH_TOKEN_RATE_LIMIT),
  async (c) => {
    const db = getDb(c.env.DB);
    const now = nowIso();
    let form: Record<string, unknown>;
    try {
      form = await c.req.parseBody();
    } catch {
      return c.json(oauthErrorBody('invalid_request', 'Body must be form-encoded.'), 400);
    }
    const field = (key: string): string => (typeof form[key] === 'string' ? (form[key] as string) : '');

    let result: TokenResult;
    switch (field('grant_type')) {
      case 'authorization_code':
        result = await exchangeAuthorizationCode(
          db,
          {
            code: field('code'),
            redirectUri: field('redirect_uri'),
            clientId: field('client_id'),
            codeVerifier: field('code_verifier'),
          },
          now,
        );
        break;
      case 'refresh_token':
        result = await refreshGrant(db, { refreshToken: field('refresh_token'), clientId: field('client_id') }, now);
        break;
      case DEVICE_GRANT:
        result = await exchangeDeviceCode(db, { deviceCode: field('device_code'), clientId: field('client_id') }, now);
        break;
      default:
        result = { ok: false, error: 'unsupported_grant_type' };
    }

    if (!result.ok) {
      const status = result.error === 'invalid_client' ? 401 : 400;
      return c.json(oauthErrorBody(result.error, result.description), status);
    }
    // RFC 6749 §5.1: token responses must never be cached.
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    return c.json(result.body);
  },
);
