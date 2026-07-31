/**
 * OAuth 2.1 authorization-server service (D48). remill is both AS and
 * protected resource for /mcp; MCP clients connect by URL alone.
 *
 * SEC-8, refined: "issuance authority is always a recorded human consent."
 *  - The PRIVILEGE DECISION is consent approval (`approveAuthorization` /
 *    `approveDeviceCode`) — human-only (agents refused) and gated by
 *    `authorize('manage_access', ROOT)`, the identical gate as issueToken.
 *    That call writes THE audit row; the oauth_grants row it materializes is
 *    the capability ceiling (agent principal + role + refresh window).
 *  - Everything the token endpoint does (`exchangeAuthorizationCode`,
 *    `refreshGrant`, `exchangeDeviceCode`) is CREDENTIAL RE-DERIVATION inside
 *    that ceiling: same principal, roles untouched, access expiry ≤ 1 h.
 *    Structurally, no function below the consent pair writes principal_roles
 *    or calls the manage_access-gated issueToken.
 *  - Revocation: deleting the grant cascades every derived credential (FK);
 *    auth-code replay and refresh-token reuse kill the live token chain.
 *
 * Token-surface functions return result unions (not thrown errors): OAuth
 * clients branch on raw `{error}` JSON bodies, which must bypass the app-wide
 * error shape (ERROR_HANDLING.md exception, documented in D48).
 */

import type { Database } from '@/db/client';
import { authorize, type Principal } from '@/access';
import * as oauthQ from '@/db/queries/oauth';
import * as principalQ from '@/db/queries/principals';
import * as roleQ from '@/db/queries/roles';
import {
  generateOAuthAccessToken,
  generateOAuthRefreshToken,
  generateOAuthCode,
  generateDeviceCode,
  hashToken,
} from '@/lib/token';
import {
  validateRedirectUris,
  redirectUriMatches,
  verifyPkceS256,
  generateUserCode,
  normalizeUserCode,
  appendRedirectParams,
  type OAuthErrorCode,
} from '@/lib/oauth';
import {
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_ACCESS_TOKEN_TTL_S,
  OAUTH_REFRESH_TOKEN_TTL_MS,
  OAUTH_CODE_TTL_MS,
  OAUTH_DEVICE_CODE_TTL_MS,
  OAUTH_DEVICE_POLL_INTERVAL_S,
  OAUTH_UNCONSENTED_CLIENT_TTL_MS,
} from '@/config/oauth';
import { ForbiddenError, InputValidationError } from '@/lib/errors';

const ROOT = { collection: '*' };

/** Roles offered on the consent screen: everything except `admin` (an external
 *  OAuth client is never one click from full admin — the wizard is the
 *  sanctioned path for that) and `anonymous` (meaningless to assign). */
export const CONSENT_EXCLUDED_ROLES = new Set(['admin', 'anonymous']);

/** Consent default (user decision, D48): most connections are working agents. */
export const CONSENT_DEFAULT_ROLE = 'editor';

const CLIENT_NAME_MAX = 64;

function plusMs(now: string, ms: number): string {
  return new Date(new Date(now).getTime() + ms).toISOString();
}

// ---------------------------------------------------------------------------
// Metadata documents (pure)
// ---------------------------------------------------------------------------

export function protectedResourceMetadata(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
  };
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    device_authorization_endpoint: `${base}/oauth/device-authorization`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:device_code',
    ],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591) — unauthenticated, rate-limited
// ---------------------------------------------------------------------------

export type RegisterResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: OAuthErrorCode; description: string };

export async function registerClient(db: Database, body: unknown, now: string): Promise<RegisterResult> {
  const meta = (body ?? {}) as Record<string, unknown>;
  const redirectUris = validateRedirectUris(meta.redirect_uris);
  if (!redirectUris) {
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      description:
        'redirect_uris must be a non-empty array of https, loopback-http, or private-scheme URIs without fragments.',
    };
  }
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== 'none') {
    return {
      ok: false,
      error: 'invalid_client_metadata',
      description: 'Only public clients are supported (token_endpoint_auth_method "none").',
    };
  }
  const name =
    typeof meta.client_name === 'string' && meta.client_name.trim()
      ? meta.client_name.trim().slice(0, CLIENT_NAME_MAX)
      : 'MCP client';
  // Keep only benign display metadata — never store arbitrary blobs.
  const kept: Record<string, unknown> = {};
  for (const key of ['client_uri', 'logo_uri', 'software_id', 'software_version']) {
    if (typeof meta[key] === 'string') kept[key] = (meta[key] as string).slice(0, 256);
  }
  const clientId = await oauthQ.insertClient(
    db,
    { name, redirectUris, metadata: Object.keys(kept).length ? kept : undefined },
    now,
  );
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(new Date(now).getTime() / 1000),
    },
  };
}

// ---------------------------------------------------------------------------
// Authorization request validation (GET/POST /oauth/authorize)
// ---------------------------------------------------------------------------

export interface AuthorizeParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string | null;
  readonly codeChallenge: string;
  readonly scope: string | null;
  readonly resource: string | null;
}

export type AuthorizeValidation =
  | { kind: 'ok'; clientName: string; params: AuthorizeParams }
  // client_id / redirect_uri failures: render an error page, NEVER redirect.
  | { kind: 'invalid'; message: string }
  // other param failures: safe to bounce back to the validated redirect_uri.
  | { kind: 'redirect'; redirectUrl: string };

export async function validateAuthorizeRequest(
  db: Database,
  query: Record<string, string | undefined>,
  baseUrl: string,
): Promise<AuthorizeValidation> {
  const clientId = query.client_id ?? '';
  const redirectUri = query.redirect_uri ?? '';
  const client = clientId ? await oauthQ.getClient(db, clientId) : null;
  if (!client) return { kind: 'invalid', message: 'Unknown client.' };
  if (!redirectUri || !client.redirectUris.some((r) => redirectUriMatches(r, redirectUri))) {
    return { kind: 'invalid', message: 'The redirect address is not registered for this client.' };
  }

  const bounce = (error: OAuthErrorCode, description: string): AuthorizeValidation => {
    const params: Record<string, string> = { error, error_description: description };
    if (query.state) params.state = query.state;
    return { kind: 'redirect', redirectUrl: appendRedirectParams(redirectUri, params) };
  };

  if (query.response_type !== 'code') {
    return bounce('unsupported_response_type', 'Only response_type "code" is supported.');
  }
  if (!query.code_challenge) {
    return bounce('invalid_request', 'PKCE is required: send code_challenge (S256).');
  }
  if ((query.code_challenge_method ?? '') !== 'S256') {
    return bounce('invalid_request', 'Only code_challenge_method "S256" is supported.');
  }
  if (query.resource !== undefined && query.resource.replace(/\/$/, '') !== `${baseUrl}/mcp`) {
    return bounce('invalid_target', `This server's resource is ${baseUrl}/mcp.`);
  }

  return {
    kind: 'ok',
    clientName: client.name,
    params: {
      clientId,
      redirectUri,
      state: query.state ?? null,
      codeChallenge: query.code_challenge,
      scope: query.scope ?? null,
      resource: query.resource ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Consent (the privilege decision — human-only, audited)
// ---------------------------------------------------------------------------

function refuseAgentConsent(principal: Principal): void {
  if (principal.kind !== 'user') {
    throw new ForbiddenError('Only a signed-in person can approve a connection.', {
      action: 'manage_access',
    });
  }
}

async function validateConsentRole(db: Database, role: string): Promise<void> {
  const roles = await roleQ.listRoles(db);
  if (CONSENT_EXCLUDED_ROLES.has(role) || !roles.some((r) => r.slug === role)) {
    throw new InputValidationError([{ path: 'role', message: `Role '${role}' cannot be granted here.` }]);
  }
}

/** The consent core shared by the browser and device flows: authorize as the
 *  human, then create-or-reconsent the grant. Returns ids + whether this
 *  client had connected before (reused principal). */
async function consentCore(
  db: Database,
  principal: Principal,
  input: {
    clientId: string;
    role: string;
    resource: string | null;
    code: { codeHash: string; redirectUri: string; codeChallenge: string; expiresAt: string } | null;
  },
  now: string,
): Promise<{ grantId: string; principalId: string }> {
  refuseAgentConsent(principal);
  await authorize(db, principal, 'manage_access', ROOT, now); // THE audit row for the grant
  await validateConsentRole(db, input.role);
  const client = await oauthQ.getClient(db, input.clientId);
  if (!client) throw new InputValidationError([{ path: 'client_id', message: 'Unknown client.' }]);

  const existing = await oauthQ.getGrantByClient(db, input.clientId);
  if (existing) {
    // Same registration reconnecting: reuse the agent principal, replace its
    // role with the newly chosen one, kill the old credential chain.
    await oauthQ.deleteTokensForGrant(db, existing.id);
    await oauthQ.reconsentGrant(
      db,
      {
        grantId: existing.id,
        principalId: existing.principalId,
        grantedBy: principal.id,
        role: input.role,
        resource: input.resource,
        code: input.code,
      },
      now,
    );
    return { grantId: existing.id, principalId: existing.principalId };
  }
  return oauthQ.createGrantWithPrincipal(
    db,
    {
      clientId: input.clientId,
      principalName: client.name,
      grantedBy: principal.id,
      role: input.role,
      resource: input.resource,
      code: input.code,
    },
    now,
  );
}

/** Approve a browser authorization request → the callback URL carrying the code. */
export async function approveAuthorization(
  db: Database,
  principal: Principal,
  input: { params: AuthorizeParams; role: string },
  now: string,
): Promise<{ redirectUrl: string }> {
  const code = generateOAuthCode();
  await consentCore(
    db,
    principal,
    {
      clientId: input.params.clientId,
      role: input.role,
      resource: input.params.resource,
      code: {
        codeHash: await hashToken(code),
        redirectUri: input.params.redirectUri,
        codeChallenge: input.params.codeChallenge,
        expiresAt: plusMs(now, OAUTH_CODE_TTL_MS),
      },
    },
    now,
  );
  const params: Record<string, string> = { code };
  if (input.params.state) params.state = input.params.state;
  return { redirectUrl: appendRedirectParams(input.params.redirectUri, params) };
}

/** Deny — pure: bounce the client back with access_denied. */
export function denyAuthorization(params: AuthorizeParams): { redirectUrl: string } {
  const q: Record<string, string> = { error: 'access_denied' };
  if (params.state) q.state = params.state;
  return { redirectUrl: appendRedirectParams(params.redirectUri, q) };
}

// ---------------------------------------------------------------------------
// Token endpoint (credential re-derivation — never a privilege decision)
// ---------------------------------------------------------------------------

export type TokenResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: OAuthErrorCode; description?: string; status?: number };

const invalidGrant = (description?: string): TokenResult => ({ ok: false, error: 'invalid_grant', description });

/** Cut a fresh access+refresh pair inside the grant's ceiling. The previous
 *  access token is replaced (≤1 live per grant); the refresh token rotates
 *  with one-slot reuse memory. */
async function mintPair(
  db: Database,
  grant: oauthQ.OAuthGrantRecord,
  scope: string | null,
  now: string,
): Promise<TokenResult> {
  const client = await oauthQ.getClient(db, grant.clientId);
  const accessToken = generateOAuthAccessToken();
  const refreshToken = generateOAuthRefreshToken();
  await oauthQ.deleteTokensForGrant(db, grant.id);
  await principalQ.insertToken(db, {
    principalId: grant.principalId,
    name: `OAuth · ${client?.name ?? 'MCP client'}`,
    tokenHash: await hashToken(accessToken),
    scope: null, // the role assigned at consent is the ceiling; no extra mask
    expiresAt: plusMs(now, OAUTH_ACCESS_TOKEN_TTL_MS),
    now,
    grantId: grant.id,
  });
  await oauthQ.rotateRefreshToken(
    db,
    grant.id,
    {
      newHash: await hashToken(refreshToken),
      prevHash: grant.refreshTokenHash,
      expiresAt: plusMs(now, OAUTH_REFRESH_TOKEN_TTL_MS),
    },
    now,
  );
  const body: Record<string, unknown> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: OAUTH_ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
  };
  if (scope) body.scope = scope; // echoed verbatim, never an authority (D48)
  return { ok: true, body };
}

export async function exchangeAuthorizationCode(
  db: Database,
  input: { code: string; redirectUri: string; clientId: string; codeVerifier: string },
  now: string,
): Promise<TokenResult> {
  if (!input.code || !input.codeVerifier || !input.clientId || !input.redirectUri) {
    return { ok: false, error: 'invalid_request', description: 'code, redirect_uri, client_id and code_verifier are required.' };
  }
  const record = await oauthQ.findCodeByHash(db, await hashToken(input.code));
  if (!record) return invalidGrant();
  const grant = await oauthQ.getGrant(db, record.grantId);
  if (!grant || grant.clientId !== input.clientId) return invalidGrant();
  if (record.consumedAt) {
    // Replay of a consumed code — treat the chain as compromised (OAuth 2.1 §4.1.2).
    await oauthQ.killRefreshChain(db, grant.id);
    return invalidGrant();
  }
  if (record.expiresAt <= now) return invalidGrant();
  if (record.redirectUri !== input.redirectUri) return invalidGrant();
  if (!(await verifyPkceS256(input.codeVerifier, record.codeChallenge))) return invalidGrant();
  await oauthQ.consumeCode(db, record.id, now);
  return mintPair(db, grant, null, now);
}

export async function refreshGrant(
  db: Database,
  input: { refreshToken: string; clientId: string },
  now: string,
): Promise<TokenResult> {
  if (!input.refreshToken || !input.clientId) {
    return { ok: false, error: 'invalid_request', description: 'refresh_token and client_id are required.' };
  }
  const hash = await hashToken(input.refreshToken);
  const grant = await oauthQ.getGrantByRefreshHash(db, hash);
  if (!grant) {
    // A rotated-out token being replayed is a theft signal: kill the chain.
    const stolen = await oauthQ.getGrantByPrevRefreshHash(db, hash);
    if (stolen) await oauthQ.killRefreshChain(db, stolen.id);
    return invalidGrant();
  }
  if (grant.clientId !== input.clientId) return invalidGrant();
  if (!grant.refreshExpiresAt || grant.refreshExpiresAt <= now) return invalidGrant();
  if (!(await principalQ.isPrincipalActive(db, grant.principalId))) return invalidGrant();
  return mintPair(db, grant, null, now);
}

// ---------------------------------------------------------------------------
// Device pairing (RFC 8628)
// ---------------------------------------------------------------------------

export async function startDeviceAuthorization(
  db: Database,
  input: { clientId: string; resource: string | null },
  baseUrl: string,
  now: string,
): Promise<TokenResult> {
  const client = input.clientId ? await oauthQ.getClient(db, input.clientId) : null;
  if (!client) return { ok: false, error: 'invalid_client', description: 'Register via dynamic client registration first.' };
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  await oauthQ.insertDeviceCode(
    db,
    {
      deviceCodeHash: await hashToken(deviceCode),
      userCodeHash: await hashToken(normalizeUserCode(userCode)),
      clientId: input.clientId,
      resource: input.resource,
      expiresAt: plusMs(now, OAUTH_DEVICE_CODE_TTL_MS),
    },
    now,
  );
  return {
    ok: true,
    body: {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${baseUrl}/oauth/device`,
      verification_uri_complete: `${baseUrl}/oauth/device?code=${encodeURIComponent(userCode)}`,
      expires_in: OAUTH_DEVICE_CODE_TTL_MS / 1000,
      interval: OAUTH_DEVICE_POLL_INTERVAL_S,
    },
  };
}

/** Resolve a user-entered pairing code to its pending request. Invalid,
 *  expired, denied, and already-approved are indistinguishable (no oracle). */
export async function findPendingDevicePairing(
  db: Database,
  userCodeInput: string,
  now: string,
): Promise<{ deviceId: string; clientId: string; clientName: string; resource: string | null } | null> {
  const normalized = normalizeUserCode(userCodeInput);
  if (!normalized) return null;
  const device = await oauthQ.findDeviceByUserHash(db, await hashToken(normalized));
  if (!device || device.expiresAt <= now || device.deniedAt || device.grantId) return null;
  const client = await oauthQ.getClient(db, device.clientId);
  if (!client) return null;
  return { deviceId: device.id, clientId: device.clientId, clientName: client.name, resource: device.resource };
}

/** Approve a device pairing — same human-only consent core, no redirect/PKCE. */
export async function approveDeviceCode(
  db: Database,
  principal: Principal,
  input: { deviceId: string; role: string },
  now: string,
): Promise<void> {
  const pending = await oauthQ.findDeviceById(db, input.deviceId);
  if (!pending || pending.expiresAt <= now || pending.deniedAt || pending.grantId) {
    throw new InputValidationError([{ path: 'code', message: 'This pairing request is no longer valid.' }]);
  }
  const { grantId } = await consentCore(
    db,
    principal,
    { clientId: pending.clientId, role: input.role, resource: pending.resource, code: null },
    now,
  );
  await oauthQ.approveDevice(db, input.deviceId, grantId);
}

/** Deny a device pairing (session-authenticated page; no privilege granted). */
export async function denyDeviceCode(db: Database, deviceId: string, now: string): Promise<void> {
  await oauthQ.denyDevice(db, deviceId, now);
}

export async function exchangeDeviceCode(
  db: Database,
  input: { deviceCode: string; clientId: string },
  now: string,
): Promise<TokenResult> {
  if (!input.deviceCode || !input.clientId) {
    return { ok: false, error: 'invalid_request', description: 'device_code and client_id are required.' };
  }
  const device = await oauthQ.findDeviceByDeviceHash(db, await hashToken(input.deviceCode));
  if (!device || device.clientId !== input.clientId) return invalidGrant();
  if (device.expiresAt <= now) return { ok: false, error: 'expired_token' };
  if (device.deniedAt) {
    await oauthQ.deleteDevice(db, device.id);
    return { ok: false, error: 'access_denied' };
  }
  // slow_down BEFORE the pending check so hammering is throttled either way.
  if (device.lastPolledAt) {
    const elapsed = new Date(now).getTime() - new Date(device.lastPolledAt).getTime();
    if (elapsed < OAUTH_DEVICE_POLL_INTERVAL_S * 1000) {
      await oauthQ.stampDevicePolled(db, device.id, now);
      return { ok: false, error: 'slow_down' };
    }
  }
  await oauthQ.stampDevicePolled(db, device.id, now);
  if (!device.grantId) return { ok: false, error: 'authorization_pending' };
  const grant = await oauthQ.getGrant(db, device.grantId);
  if (!grant) return invalidGrant();
  const result = await mintPair(db, grant, null, now);
  if (result.ok) await oauthQ.deleteDevice(db, device.id);
  return result;
}

// ---------------------------------------------------------------------------
// Revocation + maintenance
// ---------------------------------------------------------------------------

/** RFC 7009: always succeeds from the caller's perspective. A refresh token
 *  kills its chain; an access token dies alone. */
export async function revokeOAuthToken(db: Database, token: string): Promise<void> {
  if (!token) return;
  const hash = await hashToken(token);
  const grant = await oauthQ.getGrantByRefreshHash(db, hash);
  if (grant) {
    await oauthQ.killRefreshChain(db, grant.id);
    return;
  }
  await oauthQ.deleteTokenByHash(db, hash);
}

/** Admin revocation of a whole connection (manage_access-gated, human-only). */
export async function revokeGrant(db: Database, principal: Principal, grantId: string, now: string): Promise<void> {
  refuseAgentConsent(principal);
  await authorize(db, principal, 'manage_access', ROOT, now);
  await oauthQ.deleteGrant(db, grantId);
}

/** principalId → client name, for "via OAuth" provenance in the admin. */
export async function oauthProvenance(db: Database, principal: Principal, now: string): Promise<Map<string, string>> {
  await authorize(db, principal, 'manage_access', ROOT, now);
  return oauthQ.grantClientNamesByPrincipal(db);
}

/** Daily maintenance (witness-free, cron): purge expired/derelict artifacts. */
export async function purgeOAuthArtifacts(db: Database, now: string): Promise<void> {
  const nowMs = new Date(now).getTime();
  const counts = await oauthQ.purgeOAuthRows(db, {
    now,
    unconsentedClientCutoff: new Date(nowMs - OAUTH_UNCONSENTED_CLIENT_TTL_MS).toISOString(),
    deadGrantCutoff: new Date(nowMs - OAUTH_REFRESH_TOKEN_TTL_MS).toISOString(),
  });
  const total = counts.codes + counts.devices + counts.tokens + counts.clients + counts.grants;
  if (total > 0) console.log(`[cron] purged oauth artifacts: ${JSON.stringify(counts)}`);
}
