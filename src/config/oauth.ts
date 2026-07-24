/**
 * OAuth 2.1 lifetimes and limits (D48). Constants, not settings — credential
 * policy is an operator decision, same reasoning as src/config/retention.ts.
 * All lifetimes are milliseconds so they compose with Date arithmetic on the
 * ISO-8601 TEXT timestamps the schema uses.
 */

/** Access tokens (`rmo_` api_tokens rows) live one hour; clients refresh. */
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Seconds variant for the token response's `expires_in` field. */
export const OAUTH_ACCESS_TOKEN_TTL_S = OAUTH_ACCESS_TOKEN_TTL_MS / 1000;

/** Refresh tokens slide: each rotation re-stamps a fresh 30-day window. A
 *  connection idle longer than this must re-consent (which reuses the agent
 *  principal — see oauth_grants' one-grant-per-client constraint). */
export const OAUTH_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Authorization codes are single-use and expire fast (OAuth 2.1 §4.1). */
export const OAUTH_CODE_TTL_MS = 60 * 1000;

/** Device codes (RFC 8628) — the whole pairing must finish inside this. */
export const OAUTH_DEVICE_CODE_TTL_MS = 10 * 60 * 1000;

/** Minimum seconds between device-code polls; faster gets `slow_down`. */
export const OAUTH_DEVICE_POLL_INTERVAL_S = 5;

/** DCR registrations that never reach an approved grant are purged after this
 *  (the register endpoint is unauthenticated by design — RFC 7591). */
export const OAUTH_UNCONSENTED_CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
