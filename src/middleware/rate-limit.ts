/**
 * KV-backed fixed-window rate limiting (steering/SECURITY_STANDARDS.md §8, SEC-2).
 *
 * Keyed on `CF-Connecting-IP` — the edge-set client IP, which is not spoofable.
 * We NEVER read `X-Forwarded-For`. A fixed window (bucket = floor(now / window))
 * keeps the KV footprint to one counter per client per window, expired
 * automatically via `expirationTtl`.
 *
 * DEGRADES TO A NO-OP when the `RATE_LIMIT` KV binding is absent — unit tests
 * construct the app via `app.request(..., env)` WITHOUT a KV binding, so the
 * limiter must never block them. Production/preview bind the namespace in
 * wrangler.jsonc, so the limits are live there.
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { Env } from '@/types';
import { AppError } from '@/lib/errors';

export interface RateLimitTier {
  /** Max requests permitted per window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
}

/**
 * Tiers. The global ceiling is a soft site-wide guard; the abuse-prone endpoints
 * (login, token issuance, upload) are far tighter per SECURITY_STANDARDS §8.
 */
export const GLOBAL_RATE_LIMIT: RateLimitTier = { limit: 1000, windowSeconds: 60 };
export const LOGIN_RATE_LIMIT: RateLimitTier = { limit: 10, windowSeconds: 60 };
export const TOKEN_RATE_LIMIT: RateLimitTier = { limit: 20, windowSeconds: 60 };
export const UPLOAD_RATE_LIMIT: RateLimitTier = { limit: 30, windowSeconds: 60 };

/** What the limiter records on the context for `apiJson` to surface as headers. */
export interface RateLimitInfo {
  readonly limit: number;
  readonly remaining: number;
}

// Register the context variable so c.set/c.get('rateLimitInfo') are typed across
// the app (hono/secure-headers already narrows ContextVariableMap, so an explicit
// augmentation is required).
declare module 'hono' {
  interface ContextVariableMap {
    rateLimitInfo?: RateLimitInfo;
  }
}

/** Context key under which the most-recent limiter decision is stashed. */
export const RATE_LIMIT_INFO_KEY = 'rateLimitInfo';

/** The edge-set client IP, or a stable fallback for local/dev where it's absent. */
export function clientKey(c: Context<{ Bindings: Env }>): string {
  return c.req.header('CF-Connecting-IP') || 'local';
}

/**
 * Consume one unit of a fixed-window limit for `clientId`, or throw 429. The
 * shared core behind the route middleware AND in-handler consumers (the MCP
 * `upload_media` tool, which shares the 'upload' bucket with REST — D34).
 * No KV binding → allow (tests / unconfigured local; see file header).
 */
export async function consumeRateLimit(
  kv: KVNamespace | undefined,
  name: string,
  tier: RateLimitTier,
  clientId: string,
): Promise<RateLimitInfo | undefined> {
  if (!kv) return undefined;

  const window = Math.floor(Date.now() / 1000 / tier.windowSeconds);
  const key = `rl:${name}:${window}:${clientId}`;
  const count = Number((await kv.get(key)) ?? '0') || 0;

  if (count >= tier.limit) {
    throw new AppError(
      `Rate limit exceeded for ${name}`,
      429,
      'RATE_LIMITED',
      'Too many requests — please slow down and try again shortly.',
    );
  }

  // Increment; keep the counter for two windows so late requests still count.
  await kv.put(key, String(count + 1), { expirationTtl: Math.max(60, tier.windowSeconds * 2) });
  return { limit: tier.limit, remaining: Math.max(0, tier.limit - (count + 1)) };
}

/**
 * Build a rate-limit middleware for one tier. `name` namespaces the counter so
 * (e.g.) the login limit and the global limit don't share a bucket.
 */
export function rateLimit(name: string, tier: RateLimitTier) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    try {
      const info = await consumeRateLimit(c.env.RATE_LIMIT, name, tier, clientKey(c));
      if (info) c.set(RATE_LIMIT_INFO_KEY, info);
    } catch (e) {
      if (e instanceof AppError && e.code === 'RATE_LIMITED') {
        c.header('Retry-After', String(tier.windowSeconds));
      }
      throw e;
    }
    return next();
  });
}
