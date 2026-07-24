import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as oauth from '@/services/oauth';
import * as oauthQ from '@/db/queries/oauth';
import { listTokens, findTokenByHash, setPrincipalDisabled, getPrincipal } from '@/db/queries/principals';
import { getPrincipalPermissions } from '@/db/queries/roles';
import { hashToken } from '@/lib/token';
import { pkceChallengeFromVerifier } from '@/lib/oauth';
import { auditLog, principals as principalsTable, oauthClients } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/access';
import { ForbiddenError, InputValidationError } from '@/lib/errors';

const NOW = '2026-07-23T12:00:00Z';
const LATER = '2026-07-23T12:30:00Z'; // inside access TTL, outside code TTL
const BASE = 'https://remill.test';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

async function registerTestClient(db: Database, redirect = 'http://127.0.0.1/cb'): Promise<string> {
  const result = await oauth.registerClient(
    db,
    { client_name: 'Claude Code', redirect_uris: [redirect] },
    NOW,
  );
  if (!result.ok) throw new Error(result.error);
  return result.body.client_id as string;
}

async function authorizeParams(db: Database, clientId: string): Promise<oauth.AuthorizeParams> {
  const validated = await oauth.validateAuthorizeRequest(
    db,
    {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1/cb',
      state: 'xyz',
      code_challenge: await pkceChallengeFromVerifier(VERIFIER),
      code_challenge_method: 'S256',
    },
    BASE,
  );
  if (validated.kind !== 'ok') throw new Error(validated.kind);
  return validated.params;
}

/** Run the whole approve → exchange flow, returning the token response body. */
async function connectFlow(db: Database, admin: Principal, clientId: string, role = 'editor') {
  const params = await authorizeParams(db, clientId);
  const { redirectUrl } = await oauth.approveAuthorization(db, admin, { params, role }, NOW);
  const code = new URL(redirectUrl).searchParams.get('code')!;
  const result = await oauth.exchangeAuthorizationCode(
    db,
    { code, redirectUri: 'http://127.0.0.1/cb', clientId, codeVerifier: VERIFIER },
    NOW,
  );
  if (!result.ok) throw new Error(`exchange failed: ${result.error}`);
  return result.body as { access_token: string; refresh_token: string; expires_in: number };
}

describe('oauth service — registration + authorize validation', () => {
  let db: Database;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
  });

  it('registers a public client and echoes DCR metadata', async () => {
    const result = await oauth.registerClient(
      db,
      { client_name: 'Claude Code', redirect_uris: ['https://claude.ai/cb'] },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.client_id).toMatch(/^ocl_/);
    expect(result.body.token_endpoint_auth_method).toBe('none');
  });

  it('rejects bad redirect URIs and confidential-client requests', async () => {
    const badUri = await oauth.registerClient(db, { redirect_uris: ['http://evil.example/cb'] }, NOW);
    expect(badUri.ok).toBe(false);
    if (!badUri.ok) expect(badUri.error).toBe('invalid_redirect_uri');
    const confidential = await oauth.registerClient(
      db,
      { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'client_secret_basic' },
      NOW,
    );
    expect(confidential.ok).toBe(false);
  });

  it('clamps and defaults the untrusted client name', async () => {
    const result = await oauth.registerClient(
      db,
      { client_name: 'x'.repeat(200), redirect_uris: ['https://a.example/cb'] },
      NOW,
    );
    if (!result.ok) throw new Error('register failed');
    expect((result.body.client_name as string).length).toBe(64);
    const unnamed = await oauth.registerClient(db, { redirect_uris: ['https://a.example/cb'] }, NOW);
    if (!unnamed.ok) throw new Error('register failed');
    expect(unnamed.body.client_name).toBe('MCP client');
  });

  it('never redirects on unknown client or unregistered redirect_uri', async () => {
    const unknown = await oauth.validateAuthorizeRequest(db, { client_id: 'ocl_nope', redirect_uri: 'https://a/cb' }, BASE);
    expect(unknown.kind).toBe('invalid');
    const clientId = await registerTestClient(db);
    const badRedirect = await oauth.validateAuthorizeRequest(
      db,
      { client_id: clientId, redirect_uri: 'https://elsewhere.example/cb', response_type: 'code' },
      BASE,
    );
    expect(badRedirect.kind).toBe('invalid');
  });

  it('bounces param errors back to the validated redirect_uri with state', async () => {
    const clientId = await registerTestClient(db);
    const noPkce = await oauth.validateAuthorizeRequest(
      db,
      { client_id: clientId, redirect_uri: 'http://127.0.0.1/cb', response_type: 'code', state: 's1' },
      BASE,
    );
    expect(noPkce.kind).toBe('redirect');
    if (noPkce.kind !== 'redirect') return;
    const url = new URL(noPkce.redirectUrl);
    expect(url.searchParams.get('error')).toBe('invalid_request');
    expect(url.searchParams.get('state')).toBe('s1');
  });

  it('validates the RFC 8707 resource indicator when present', async () => {
    const clientId = await registerTestClient(db);
    const bad = await oauth.validateAuthorizeRequest(
      db,
      {
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1/cb',
        response_type: 'code',
        code_challenge: 'c'.repeat(43),
        code_challenge_method: 'S256',
        resource: 'https://other.example/mcp',
      },
      BASE,
    );
    expect(bad.kind).toBe('redirect');
    if (bad.kind === 'redirect') expect(bad.redirectUrl).toContain('invalid_target');
  });
});

describe('oauth service — consent, exchange, refresh (the SEC-8 core)', () => {
  let db: Database;
  let admin: Principal;
  let clientId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    clientId = await registerTestClient(db);
  });

  it('approve → exchange yields a working rmo_ access token with the consented role', async () => {
    const body = await connectFlow(db, admin, clientId, 'editor');
    expect(body.access_token).toMatch(/^rmo_/);
    expect(body.refresh_token).toMatch(/^rmr_/);
    expect(body.expires_in).toBe(3600);

    // The access token is an ordinary api_tokens row: resolvable by hash, expiring.
    const row = await findTokenByHash(db, await hashToken(body.access_token));
    expect(row).not.toBeNull();
    const grant = await oauthQ.getGrantByClient(db, clientId);
    expect(grant?.role).toBe('editor');
    // The agent principal holds exactly the consented role.
    const perms = await getPrincipalPermissions(db, grant!.principalId);
    expect(perms.some((p) => p.action === 'update' && p.collection === '*')).toBe(true);
    expect(perms.some((p) => p.action === 'manage_access')).toBe(false);
    // Principal is named after the client.
    const agent = await getPrincipal(db, grant!.principalId);
    expect(agent?.name).toBe('Claude Code');
    expect(agent?.kind).toBe('agent');
  });

  it('writes exactly one audit row per consent (the manage_access decision)', async () => {
    const before = (await db.select().from(auditLog)).length;
    const params = await authorizeParams(db, clientId);
    await oauth.approveAuthorization(db, admin, { params, role: 'reader' }, NOW);
    const rows = await db.select().from(auditLog);
    expect(rows.length).toBe(before + 1);
    expect(rows[rows.length - 1].action).toBe('manage_access');
    expect(rows[rows.length - 1].principalId).toBe('prn_admin');
  });

  it('SEC-8: agents and non-admins cannot consent; admin/anonymous roles refused', async () => {
    const agent = await makePrincipal(db, NOW, { id: 'prn_bot', kind: 'agent', role: 'admin', surface: 'mcp' });
    const params = await authorizeParams(db, clientId);
    await expect(oauth.approveAuthorization(db, agent, { params, role: 'reader' }, NOW)).rejects.toThrow(ForbiddenError);
    const editor = await makePrincipal(db, NOW, { id: 'prn_ed', role: 'editor' });
    await expect(oauth.approveAuthorization(db, editor, { params, role: 'reader' }, NOW)).rejects.toThrow(ForbiddenError);
    await expect(oauth.approveAuthorization(db, admin, { params, role: 'admin' }, NOW)).rejects.toThrow(InputValidationError);
    await expect(oauth.approveAuthorization(db, admin, { params, role: 'anonymous' }, NOW)).rejects.toThrow(InputValidationError);
  });

  it('exchange enforces PKCE, redirect_uri, client binding, expiry — uniformly invalid_grant', async () => {
    const params = await authorizeParams(db, clientId);
    const { redirectUrl } = await oauth.approveAuthorization(db, admin, { params, role: 'editor' }, NOW);
    const code = new URL(redirectUrl).searchParams.get('code')!;
    const base = { code, redirectUri: 'http://127.0.0.1/cb', clientId, codeVerifier: VERIFIER };

    for (const [label, bad, at] of [
      ['wrong verifier', { ...base, codeVerifier: 'a'.repeat(43) }, NOW],
      ['wrong redirect', { ...base, redirectUri: 'http://127.0.0.1/other' }, NOW],
      ['wrong client', { ...base, clientId: 'ocl_other' }, NOW],
      ['unknown code', { ...base, code: 'rmc_bogus' }, NOW],
      ['expired code', base, LATER],
    ] as const) {
      const result = await oauth.exchangeAuthorizationCode(db, bad, at);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.error, label).toBe('invalid_grant');
    }
  });

  it('replaying a consumed code kills the grant’s live tokens', async () => {
    const params = await authorizeParams(db, clientId);
    const { redirectUrl } = await oauth.approveAuthorization(db, admin, { params, role: 'editor' }, NOW);
    const code = new URL(redirectUrl).searchParams.get('code')!;
    const input = { code, redirectUri: 'http://127.0.0.1/cb', clientId, codeVerifier: VERIFIER };
    const first = await oauth.exchangeAuthorizationCode(db, input, NOW);
    expect(first.ok).toBe(true);
    const replay = await oauth.exchangeAuthorizationCode(db, input, NOW);
    expect(replay.ok).toBe(false);
    const grant = await oauthQ.getGrantByClient(db, clientId);
    expect(await listTokens(db, grant!.principalId)).toHaveLength(0);
  });

  it('refresh rotates (old refresh dies, old access replaced), reuse kills the chain', async () => {
    const body = await connectFlow(db, admin, clientId);
    const refreshed = await oauth.refreshGrant(db, { refreshToken: body.refresh_token, clientId }, NOW);
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    const next = refreshed.body as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(body.refresh_token);
    // Old access token is gone (≤1 live per grant).
    expect(await findTokenByHash(db, await hashToken(body.access_token))).toBeNull();
    expect(await findTokenByHash(db, await hashToken(next.access_token))).not.toBeNull();
    // Replaying the ROTATED-OUT refresh token = theft → chain killed.
    const reuse = await oauth.refreshGrant(db, { refreshToken: body.refresh_token, clientId }, NOW);
    expect(reuse.ok).toBe(false);
    const grant = await oauthQ.getGrantByClient(db, clientId);
    expect(grant?.refreshTokenHash).toBeNull();
    expect(await listTokens(db, grant!.principalId)).toHaveLength(0);
    // The CURRENT refresh token is dead too.
    const afterKill = await oauth.refreshGrant(db, { refreshToken: next.refresh_token, clientId }, NOW);
    expect(afterKill.ok).toBe(false);
  });

  it('a disabled agent principal kills refresh', async () => {
    const body = await connectFlow(db, admin, clientId);
    const grant = await oauthQ.getGrantByClient(db, clientId);
    await setPrincipalDisabled(db, grant!.principalId, true);
    const result = await oauth.refreshGrant(db, { refreshToken: body.refresh_token, clientId }, NOW);
    expect(result.ok).toBe(false);
  });

  it('reconnecting the same client reuses the principal and replaces its role', async () => {
    await connectFlow(db, admin, clientId, 'editor');
    const before = await oauthQ.getGrantByClient(db, clientId);
    await connectFlow(db, admin, clientId, 'reader');
    const after = await oauthQ.getGrantByClient(db, clientId);
    expect(after?.principalId).toBe(before?.principalId);
    expect(after?.role).toBe('reader');
    const perms = await getPrincipalPermissions(db, after!.principalId);
    expect(perms.some((p) => p.action === 'update')).toBe(false); // editor role fully replaced
    const agents = await db.select().from(principalsTable).where(eq(principalsTable.kind, 'agent'));
    expect(agents).toHaveLength(1); // no principal duplication
  });

  it('revoking the grant cascades every derived credential', async () => {
    const body = await connectFlow(db, admin, clientId);
    const grant = await oauthQ.getGrantByClient(db, clientId);
    await oauth.revokeGrant(db, admin, grant!.id, NOW);
    expect(await findTokenByHash(db, await hashToken(body.access_token))).toBeNull();
    expect(await oauthQ.getGrantByClient(db, clientId)).toBeNull();
    // The agent principal survives for admin inspection.
    expect(await getPrincipal(db, grant!.principalId)).not.toBeNull();
  });

  it('RFC 7009 revocation: refresh token kills the chain, access token dies alone', async () => {
    const body = await connectFlow(db, admin, clientId);
    await oauth.revokeOAuthToken(db, body.access_token);
    expect(await findTokenByHash(db, await hashToken(body.access_token))).toBeNull();
    const refreshStillWorks = await oauth.refreshGrant(db, { refreshToken: body.refresh_token, clientId }, NOW);
    expect(refreshStillWorks.ok).toBe(true);
    if (!refreshStillWorks.ok) return;
    await oauth.revokeOAuthToken(db, (refreshStillWorks.body as { refresh_token: string }).refresh_token);
    const grant = await oauthQ.getGrantByClient(db, clientId);
    expect(grant?.refreshTokenHash).toBeNull();
  });
});

describe('oauth service — device pairing (RFC 8628)', () => {
  let db: Database;
  let admin: Principal;
  let clientId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    clientId = await registerTestClient(db);
  });

  async function startPairing() {
    const started = await oauth.startDeviceAuthorization(db, { clientId, resource: null }, BASE, NOW);
    if (!started.ok) throw new Error(started.error);
    return started.body as { device_code: string; user_code: string; verification_uri: string; interval: number };
  }

  it('start → pending → approve → exchange → tokens; row cleaned up', async () => {
    const pairing = await startPairing();
    expect(pairing.device_code).toMatch(/^rmd_/);
    expect(pairing.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(pairing.verification_uri).toBe(`${BASE}/oauth/device`);

    const pendingPoll = await oauth.exchangeDeviceCode(db, { deviceCode: pairing.device_code, clientId }, NOW);
    expect(pendingPoll.ok).toBe(false);
    if (!pendingPoll.ok) expect(pendingPoll.error).toBe('authorization_pending');

    const found = await oauth.findPendingDevicePairing(db, pairing.user_code.toLowerCase(), NOW);
    expect(found?.clientName).toBe('Claude Code');
    await oauth.approveDeviceCode(db, admin, { deviceId: found!.deviceId, role: 'reader' }, NOW);

    // Respect the poll interval (last poll was at NOW).
    const at = '2026-07-23T12:00:10Z';
    const result = await oauth.exchangeDeviceCode(db, { deviceCode: pairing.device_code, clientId }, at);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.body as { access_token: string }).access_token).toMatch(/^rmo_/);
    // One-shot: the device row is gone.
    const again = await oauth.exchangeDeviceCode(db, { deviceCode: pairing.device_code, clientId }, at);
    expect(again.ok).toBe(false);
  });

  it('polling faster than the interval gets slow_down; denial gets access_denied', async () => {
    const pairing = await startPairing();
    await oauth.exchangeDeviceCode(db, { deviceCode: pairing.device_code, clientId }, NOW);
    const tooFast = await oauth.exchangeDeviceCode(db, { deviceCode: pairing.device_code, clientId }, '2026-07-23T12:00:02Z');
    if (tooFast.ok) throw new Error('expected error');
    expect(tooFast.error).toBe('slow_down');

    const found = await oauth.findPendingDevicePairing(db, pairing.user_code, NOW);
    await oauth.denyDeviceCode(db, found!.deviceId, NOW);
    const denied = await oauth.exchangeDeviceCode(db, { deviceCode: pairing.device_code, clientId }, '2026-07-23T12:00:20Z');
    if (denied.ok) throw new Error('expected error');
    expect(denied.error).toBe('access_denied');
  });

  it('expired/denied/approved pairings are invisible to the user-code lookup', async () => {
    const pairing = await startPairing();
    expect(await oauth.findPendingDevicePairing(db, pairing.user_code, '2026-07-23T13:00:00Z')).toBeNull(); // expired
    expect(await oauth.findPendingDevicePairing(db, 'ZZZZ-ZZZZ', NOW)).toBeNull(); // unknown
    const found = await oauth.findPendingDevicePairing(db, pairing.user_code, NOW);
    await oauth.approveDeviceCode(db, admin, { deviceId: found!.deviceId, role: 'reader' }, NOW);
    expect(await oauth.findPendingDevicePairing(db, pairing.user_code, NOW)).toBeNull(); // already approved
  });

  it('SEC-8: device approval refuses agents', async () => {
    const pairing = await startPairing();
    const found = await oauth.findPendingDevicePairing(db, pairing.user_code, NOW);
    const agent = await makePrincipal(db, NOW, { id: 'prn_bot2', kind: 'agent', role: 'admin', surface: 'mcp' });
    await expect(oauth.approveDeviceCode(db, agent, { deviceId: found!.deviceId, role: 'reader' }, NOW)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('oauth service — maintenance purge', () => {
  it('purges expired codes/devices/tokens, unconsented clients, dead grants', async () => {
    const db = getDb(createTestD1());
    await seedRoles(db, NOW);
    const admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    const clientId = await registerTestClient(db);
    await connectFlow(db, admin, clientId);
    // A second client that never consents.
    await oauth.registerClient(db, { redirect_uris: ['https://x.example/cb'] }, NOW);

    // Far future: access token expired, refresh window (30d) + dead-grant margin passed.
    const future = '2026-10-01T00:00:00Z';
    await oauth.purgeOAuthArtifacts(db, future);
    expect(await oauthQ.getGrantByClient(db, clientId)).toBeNull(); // dead grant purged
    expect(await oauthQ.getClient(db, clientId)).not.toBeNull(); // consented client kept (grant cascade removed only grant)
    const clients = await db.select().from(oauthClients);
    expect(clients).toHaveLength(1); // unconsented one purged
  });
});
