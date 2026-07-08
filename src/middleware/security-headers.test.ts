import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { documents } from '@/db/schema';
import type { Env } from '@/types';

const CDN = 'https://cdn.jsdelivr.net';

/** Flip the allowCdnScripts setting by writing the settings singleton row
 *  directly (the middleware reads it via the un-gated getSettings). */
async function setCdnToggle(db: Database, on: boolean) {
  await db.insert(documents).values({
    id: 'doc_settings_test',
    collection: 'settings',
    dataJson: JSON.stringify({ siteName: 'T', allowCdnScripts: on }),
    status: 'published',
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
  });
}

describe('security headers (D27) — per-surface CSP fork + CDN toggle', () => {
  let db: Database;
  let env: Pick<Env, 'DB' | 'SESSION_SECRET' | 'BASE_URL'>;

  beforeEach(() => {
    const d1 = createTestD1({ seed: true });
    db = getDb(d1);
    env = { DB: d1, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://test' };
  });

  const cspOf = async (path: string) =>
    (await app.request(path, {}, env)).headers.get('content-security-policy') ?? '';

  it('public paths default to the STRICT policy (toggle off / unset)', async () => {
    for (const path of ['/', '/nope/nope', '/s/rms_bogus']) {
      const csp = await cspOf(path);
      expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
      expect(csp).not.toContain(CDN);
    }
  });

  it('with the toggle ON, public paths gain exactly the allowlisted CDN hosts — admin stays strict', async () => {
    await setCdnToggle(db, true);

    const publicCsp = await cspOf('/nope/nope');
    expect(publicCsp).toContain(CDN);
    expect(publicCsp).toContain('https://unpkg.com');
    // No wildcards, and only script-src widened.
    expect(publicCsp).not.toContain('*.');
    expect(publicCsp).toContain("default-src 'self'");
    expect(publicCsp).toContain("connect-src 'self'");

    // /s/:token is a public surface too.
    expect(await cspOf('/s/rms_bogus')).toContain(CDN);

    // Protected surfaces never widen, toggle or not.
    for (const path of ['/admin/login', '/api/collections', '/media/med_x']) {
      const csp = await cspOf(path);
      expect(csp, path).not.toContain(CDN);
      expect(csp, path).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    }
  });

  it('non-CSP headers ride along on both surfaces', async () => {
    const res = await app.request('/nope/nope', {}, env);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});
