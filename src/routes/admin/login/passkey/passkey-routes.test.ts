import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { createTestAuthenticator } from '@/test/webauthn';
import { LOGIN_RATE_LIMIT } from '@/middleware/rate-limit';

const ORIGIN = 'https://remill.test';
const PASSWORD = 'remilladmin'; // the seeded dev admin (src/test/d1.ts)

type TestEnv = { DB: D1Database; SESSION_SECRET: string; BASE_URL: string; RATE_LIMIT?: KVNamespace };

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => void store.set(key, value),
  } as unknown as KVNamespace;
}

/** The `name=value` session pair from a response, ready for a `Cookie` header.
 *  hono-sessions sets the cookie twice on login; like a browser, keep the last. */
function sessionCookie(res: Response): string {
  const pair = (res.headers as Headers & { getSetCookie(): string[] })
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => c.startsWith('session='))
    .at(-1);
  if (!pair) throw new Error('no session cookie set');
  return pair;
}

describe('passkey routes (D58)', () => {
  let env: TestEnv;

  const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(
      `${ORIGIN}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
        body: JSON.stringify(body),
      },
      env,
    );

  async function passwordLogin(): Promise<string> {
    const res = await app.request(
      `${ORIGIN}/admin/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'admin@remill.local', password: PASSWORD }).toString(),
      },
      env,
    );
    return sessionCookie(res);
  }

  beforeEach(() => {
    env = { DB: createTestD1({ seed: true }), SESSION_SECRET: 'x'.repeat(32), BASE_URL: ORIGIN };
  });

  it('enrols a passkey from a password session, then signs in with it alone', async () => {
    const device = await createTestAuthenticator();
    const Cookie = await passwordLogin();

    const options = await postJson(
      '/admin/account/passkeys/options',
      { name: 'Laptop', currentPassword: PASSWORD },
      { Cookie },
    );
    expect(options.status).toBe(200);
    const added = await postJson(
      '/admin/account/passkeys',
      { name: 'Laptop', response: await device.register(await options.json(), ORIGIN) },
      { Cookie },
    );
    expect(await added.json()).toEqual({ redirect: '/admin/account' });

    // A fresh browser: no cookie, only the passkey.
    const request = await postJson('/admin/login/passkey/options', {});
    const verified = await postJson('/admin/login/passkey/verify', {
      response: await device.authenticate(await request.json(), ORIGIN),
      redirect: '/admin/c',
    });
    expect(await verified.json()).toEqual({ redirect: '/admin/c' });

    const account = await app.request(`${ORIGIN}/admin/account`, { headers: { Cookie: sessionCookie(verified) } }, env);
    expect(account.status).toBe(200);
    expect(await account.text()).toContain('Laptop');
  });

  it('answers a failed sign-in with 403 and no session, and never an open redirect', async () => {
    const device = await createTestAuthenticator(); // never enrolled
    const request = await postJson('/admin/login/passkey/options', {});
    const res = await postJson('/admin/login/passkey/verify', {
      response: await device.authenticate(await request.json(), ORIGIN),
      redirect: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'That passkey could not be used to sign in.' });
    // Whatever cookie came back carries no signed-in user.
    const Cookie = sessionCookie(res);
    const account = await app.request(`${ORIGIN}/admin/account`, { headers: { Cookie } }, env);
    expect(account.status).toBe(302);
  });

  it('refuses a cross-origin or origin-less request on every JSON endpoint (CSRF)', async () => {
    const Cookie = await passwordLogin();
    const paths = [
      '/admin/login/passkey/options',
      '/admin/login/passkey/verify',
      '/admin/account/passkeys/options',
      '/admin/account/passkeys',
    ];
    for (const path of paths) {
      for (const Origin of ['https://evil.example', 'null', '']) {
        const res = await postJson(path, { name: 'Laptop', currentPassword: PASSWORD }, { Cookie, Origin });
        expect(res.status, `${path} from ${Origin || '(none)'}`).toBe(403);
      }
    }
  });

  it('limits current-password guesses on enrolment per person', async () => {
    env.RATE_LIMIT = fakeKV();
    const Cookie = await passwordLogin();
    const guess = () =>
      postJson('/admin/account/passkeys/options', { name: 'Laptop', currentPassword: 'wrongpass' }, { Cookie });
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit; i++) expect((await guess()).status).toBe(422);
    expect((await guess()).status).toBe(429);
  });

  it('requires a session to add a passkey', async () => {
    const res = await postJson('/admin/account/passkeys/options', { name: 'Laptop', currentPassword: PASSWORD });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/admin/login');
  });

  it('reports a wrong current password as a JSON error', async () => {
    const res = await postJson(
      '/admin/account/passkeys/options',
      { name: 'Laptop', currentPassword: 'wrongpass' },
      { Cookie: await passwordLogin() },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Current password is incorrect.' });
  });

  it('rate-limits options and verify on separate buckets', async () => {
    env.RATE_LIMIT = fakeKV();
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit; i++) {
      expect((await postJson('/admin/login/passkey/options', {})).status).toBe(200);
    }
    const res = await postJson('/admin/login/passkey/options', {});
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe(String(LOGIN_RATE_LIMIT.windowSeconds));

    // Page-load option requests have not used up the sign-in attempts.
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit; i++) {
      expect((await postJson('/admin/login/passkey/verify', { response: {} })).status).toBe(403);
    }
    expect((await postJson('/admin/login/passkey/verify', { response: {} })).status).toBe(429);
  });
});
