import { describe, it, expect, beforeEach } from 'vitest';
import type { Context } from 'hono';
import app from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as media from '@/services/media';
import { assertBodyWithinLimit } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { LOGIN_RATE_LIMIT } from '@/middleware/rate-limit';
import type { Principal } from '@/access';

const NOW = '2026-07-04T12:00:00Z';
const SECRET = 'x'.repeat(32);
const ADMIN: Principal = { id: 'prn_admin0000000000000', kind: 'user', surface: 'admin' };

type TestEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  SESSION_SECRET: string;
  BASE_URL: string;
  RATE_LIMIT?: KVNamespace;
};

/** Minimal in-memory KV covering the get/put the limiter uses. */
function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

/** Minimal in-memory R2 covering put/get. */
function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    async put(key: string, value: Uint8Array) {
      store.set(key, value);
      return {};
    },
    async get(key: string) {
      const v = store.get(key);
      return v ? { body: v } : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as R2Bucket;
}

/** A 24-byte PNG header declaring 100×50. */
function pngBytes(): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, 100);
  new DataView(b.buffer).setUint32(20, 50);
  return b;
}

describe('security middleware — headers, rate limiting, body cap', () => {
  let db: Database;
  let env: TestEnv;
  let bucket: R2Bucket;

  beforeEach(() => {
    const d1 = createTestD1({ seed: true }); // roles + media (publicRead) + dev admin
    db = getDb(d1);
    bucket = fakeR2();
    env = { DB: d1, MEDIA: bucket, SESSION_SECRET: SECRET, BASE_URL: 'http://test' };
  });

  it('SEC-3: an admin response carries the security headers with a Datastar-safe CSP', async () => {
    const res = await app.request('/admin/login', {}, env);
    const csp = res.headers.get('content-security-policy') ?? '';
    // Datastar compiles data-* expressions via Function() → CSP must allow unsafe-eval.
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("default-src 'self'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('SEC-3: /media responses set nosniff + Content-Disposition: inline', async () => {
    const rec = await media.uploadMedia(db, bucket, ADMIN, { filename: 'a.png', bytes: pngBytes(), alt: 'A' }, NOW);
    const res = await app.request(`/media/${rec.id}`, {}, env); // anonymous — media is publicRead
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('SEC-2: over-limit login returns 429 when the KV binding is present', async () => {
    const withKv: TestEnv = { ...env, RATE_LIMIT: fakeKV() };
    const post = () =>
      app.request(
        '/admin/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email: 'nobody@remill.local', password: 'x' }).toString(),
        },
        withKv,
      );

    const statuses: number[] = [];
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit + 1; i++) statuses.push((await post()).status);

    // The first `limit` are allowed (bad-credential fragment, 200); the next is 429.
    expect(statuses.slice(0, LOGIN_RATE_LIMIT.limit).every((s) => s !== 429)).toBe(true);
    expect(statuses[LOGIN_RATE_LIMIT.limit]).toBe(429);
  });

  it('SEC-2: the limiter is a no-op when the KV binding is absent (tests never blocked)', async () => {
    const post = () =>
      app.request(
        '/admin/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email: 'nobody@remill.local', password: 'x' }).toString(),
        },
        env, // no RATE_LIMIT
      );
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit + 5; i++) {
      expect((await post()).status).not.toBe(429);
    }
  });

  it('SEC-2: apiJson stamps real X-RateLimit-* headers (falls back to the global tier without KV)', async () => {
    const res = await app.request('/api/collections', {}, env);
    expect(res.status).toBe(200);
    expect(Number(res.headers.get('X-RateLimit-Limit'))).toBeGreaterThan(0);
    expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
  });

  it('SEC-4: assertBodyWithinLimit rejects an oversized Content-Length with 413', () => {
    const big = { req: { header: (k: string) => (k.toLowerCase() === 'content-length' ? '2000000' : undefined) } } as unknown as Context;
    let thrown: unknown;
    try {
      assertBodyWithinLimit(big);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(413);

    const small = { req: { header: () => '10' } } as unknown as Context;
    expect(() => assertBodyWithinLimit(small)).not.toThrow();
  });
});
