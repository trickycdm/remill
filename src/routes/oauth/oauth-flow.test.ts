import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import { pkceChallengeFromVerifier } from '@/lib/oauth';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-23T12:00:00Z';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const REDIRECT = 'http://127.0.0.1:39415/callback';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

/**
 * The whole OAuth walk driven through the real Hono app (D48) — exactly what
 * an MCP client does: challenge discovery → metadata → DCR → consent (with a
 * real session cookie) → PKCE code exchange → authenticated MCP call →
 * refresh → revoke.
 */
describe('OAuth 2.1 flow — integration through the Hono app', () => {
  let db: Database;
  let env: { DB: D1Database; MEDIA: R2Bucket; SESSION_SECRET: string; BASE_URL: string };
  let admin: Principal;
  let cookie: string;

  async function req(path: string, init: RequestInit = {}) {
    const res = await app.request(path, init, env);
    return res;
  }

  const form = (fields: Record<string, string>) => ({
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await req('/admin/login', form({ email, password, redirect: '/admin' }));
    // hono-sessions sets the pre-login session AND the authenticated one — the
    // LAST session cookie is the live login. (getSetCookie exists in the
    // undici/workerd runtime but not yet in the configured TS lib.)
    const cookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies.length, 'login must set a session cookie').toBeGreaterThan(0);
    return cookies[cookies.length - 1].split(';')[0];
  }

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    env = { DB: d1, MEDIA: {} as R2Bucket, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://test' };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    await access.createUser(
      db,
      admin,
      { name: 'Col', email: 'col@remill.test', password: 'remilladmin', role: 'admin' },
      NOW,
    );
    cookie = await login('col@remill.test', 'remilladmin');
  });

  async function registerClient(): Promise<string> {
    const res = await req('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [REDIRECT] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { client_id: string };
    return body.client_id;
  }

  function authorizeUrl(clientId: string, challenge: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: 'st4te',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: 'http://test/mcp',
    });
    return `/oauth/authorize?${q.toString()}`;
  }

  /** DCR → consent-approve → code exchange; returns the token response body. */
  async function fullConnect(role = 'editor') {
    const clientId = await registerClient();
    const challenge = await pkceChallengeFromVerifier(VERIFIER);
    const consent = await req(authorizeUrl(clientId, challenge), { headers: { Cookie: cookie } });
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain('Claude Code');

    const decision = await req('/oauth/authorize', {
      ...form({
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'st4te',
        resource: 'http://test/mcp',
        role,
        decision: 'approve',
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    });
    expect(decision.status).toBe(303);
    const location = new URL(decision.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('st4te');
    const code = location.searchParams.get('code')!;
    expect(code).toMatch(/^rmc_/);

    const token = await req(
      '/oauth/token',
      form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: VERIFIER,
      }),
    );
    expect(token.status).toBe(200);
    expect(token.headers.get('cache-control')).toBe('no-store');
    return {
      clientId,
      body: (await token.json()) as { access_token: string; refresh_token: string; expires_in: number },
    };
  }

  it('① unauthenticated /mcp gets the 401 challenge; GET gets 405', async () => {
    const res = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://test/.well-known/oauth-protected-resource/mcp"',
    );
    const get = await req('/mcp');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
  });

  it('② discovery documents are served on every alias', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await req(path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { resource: string; authorization_servers: string[] };
      expect(body.resource).toBe('http://test/mcp');
      expect(body.authorization_servers).toEqual(['http://test']);
    }
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration',
    ]) {
      const res = await req(path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.issuer).toBe('http://test');
      expect(body.token_endpoint).toBe('http://test/oauth/token');
      expect(body.code_challenge_methods_supported).toEqual(['S256']);
    }
    // CORS: browser-resident clients can read the metadata cross-origin.
    const cors = await req('/.well-known/oauth-authorization-server', { headers: { Origin: 'https://claude.ai' } });
    expect(cors.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('③ logged-out /oauth/authorize bounces to login preserving the FULL query', async () => {
    const clientId = await registerClient();
    const url = authorizeUrl(clientId, await pkceChallengeFromVerifier(VERIFIER));
    const res = await req(url);
    expect(res.status).toBe(302);
    const target = res.headers.get('location')!;
    expect(target.startsWith('/admin/login?redirect=')).toBe(true);
    const bounced = decodeURIComponent(target.replace('/admin/login?redirect=', ''));
    expect(bounced).toBe(url); // state, challenge, resource all survive
  });

  it('④ full walk: DCR → consent → code → tokens → authenticated MCP call', async () => {
    const { body } = await fullConnect('editor');
    expect(body.access_token).toMatch(/^rmo_/);
    expect(body.expires_in).toBe(3600);

    const mcp = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(200);
    const rpc = (await mcp.json()) as { result: { tools: { name: string }[] } };
    const names = rpc.result.tools.map((t) => t.name);
    expect(names).toContain('create_posts'); // editor can write
    expect(names).not.toContain('install_pack'); // no manage_schema
  });

  it('⑤ token endpoint errors are raw OAuth JSON', async () => {
    const bad = await req('/oauth/token', form({ grant_type: 'password' }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'unsupported_grant_type' });
    const badCode = await req(
      '/oauth/token',
      form({ grant_type: 'authorization_code', code: 'rmc_x', redirect_uri: REDIRECT, client_id: 'ocl_x', code_verifier: 'v'.repeat(43) }),
    );
    expect(badCode.status).toBe(400);
    expect(((await badCode.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('⑥ refresh rotates; the old access token is dead; replayed refresh kills the chain', async () => {
    const { clientId, body } = await fullConnect();
    const refreshed = await req(
      '/oauth/token',
      form({ grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: clientId }),
    );
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };

    const oldToken = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(oldToken.status).toBe(401);
    expect(oldToken.headers.get('www-authenticate')).toContain('invalid_token');

    const replay = await req(
      '/oauth/token',
      form({ grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: clientId }),
    );
    expect(replay.status).toBe(400);
    // Chain killed: even the fresh pair no longer works.
    const dead = await req(
      '/oauth/token',
      form({ grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: clientId }),
    );
    expect(dead.status).toBe(400);
  });

  it('⑦ deny bounces back with access_denied; non-admin sees the ask-admin card', async () => {
    const clientId = await registerClient();
    const challenge = await pkceChallengeFromVerifier(VERIFIER);
    const denied = await req('/oauth/authorize', {
      ...form({
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 's',
        decision: 'deny',
        role: 'editor',
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    });
    expect(denied.status).toBe(303);
    const loc = new URL(denied.headers.get('location')!);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('s');

    await access.createUser(db, admin, { name: 'Ed', email: 'ed@remill.test', password: 'password1', role: 'editor' }, NOW);
    const edCookie = await login('ed@remill.test', 'password1');
    const consent = await req(authorizeUrl(clientId, challenge), { headers: { Cookie: edCookie } });
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain('only an administrator');
  });

  it('⑧ untrusted client_name renders as text, never markup', async () => {
    const res = await req('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: '<b>evil</b>', redirect_uris: [REDIRECT] }),
    });
    const { client_id } = (await res.json()) as { client_id: string };
    const consent = await req(authorizeUrl(client_id, await pkceChallengeFromVerifier(VERIFIER)), {
      headers: { Cookie: cookie },
    });
    const html = await consent.text();
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
    expect(html).not.toContain('<b>evil</b>');
  });

  it('⑨ device flow end-to-end: start → approve on /oauth/device → poll → tokens', async () => {
    const clientId = await registerClient();
    const start = await req('/oauth/device-authorization', form({ client_id: clientId }));
    expect(start.status).toBe(200);
    const pairing = (await start.json()) as { device_code: string; user_code: string; verification_uri: string };
    expect(pairing.verification_uri).toBe('http://test/oauth/device');

    // Human enters the code (lookup) then approves.
    const lookup = await req('/oauth/device', {
      ...form({ op: 'lookup', code: pairing.user_code }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    });
    const lookupHtml = await lookup.text();
    expect(lookupHtml).toContain('Claude Code');
    const deviceId = /name="device_id" value="([^"]+)"/.exec(lookupHtml)?.[1];
    expect(deviceId).toBeTruthy();
    const approve = await req('/oauth/device', {
      ...form({ op: 'decide', decision: 'approve', device_id: deviceId!, role: 'reader' }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    });
    expect(await approve.text()).toContain('Return to your terminal');

    const poll = await req(
      '/oauth/token',
      form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: pairing.device_code, client_id: clientId }),
    );
    expect(poll.status).toBe(200);
    const tokens = (await poll.json()) as { access_token: string };
    expect(tokens.access_token).toMatch(/^rmo_/);
  });

  it('⑩ RFC 7009 revoke always 200s and kills the presented credential', async () => {
    const { clientId, body } = await fullConnect();
    const revoke = await req('/oauth/revoke', form({ token: body.refresh_token }));
    expect(revoke.status).toBe(200);
    const refresh = await req(
      '/oauth/token',
      form({ grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: clientId }),
    );
    expect(refresh.status).toBe(400);
    const unknown = await req('/oauth/revoke', form({ token: 'rmo_bogus' }));
    expect(unknown.status).toBe(200);
  });
});
