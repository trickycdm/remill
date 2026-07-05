import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import { getSessionUser, requireAuth, getUser } from '@/lib/auth';
import { UnauthorizedError } from '@/lib/errors';

/**
 * The session module (getSessionUser / requireAuth / getUser) previously had zero
 * coverage (TD-8). These tests exercise the Zod-validated read of the encrypted
 * cookie (TD-12): a valid session yields the user; a missing/blank/malformed one
 * degrades safely rather than trusting an unchecked cast.
 */

/** A minimal hono-sessions-shaped stub: a Map behind get/set/deleteSession. */
function fakeSession(data: Record<string, unknown> = {}): unknown {
  const store = new Map<string, unknown>(Object.entries(data));
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    deleteSession: () => store.clear(),
  };
}

/** A minimal Hono Context whose `get`/`set` back onto a bag; optional session. */
function fakeContext(session?: unknown): Context {
  const bag = new Map<string, unknown>();
  if (session !== undefined) bag.set('session', session);
  return {
    get: (k: string) => bag.get(k),
    set: (k: string, v: unknown) => bag.set(k, v),
  } as unknown as Context;
}

describe('getSessionUser — validated session-cookie read', () => {
  it('returns null when there is no session at all', () => {
    expect(getSessionUser(fakeContext())).toBeNull();
  });

  it('returns null when userId is absent or blank', () => {
    expect(getSessionUser(fakeContext(fakeSession({})))).toBeNull();
    expect(getSessionUser(fakeContext(fakeSession({ userId: '' })))).toBeNull();
  });

  it('returns null when userId is not a string (malformed cookie)', () => {
    expect(getSessionUser(fakeContext(fakeSession({ userId: 12345 })))).toBeNull();
  });

  it('defaults email/displayName and clamps an unknown role to the least-privileged reader', () => {
    const user = getSessionUser(fakeContext(fakeSession({ userId: 'prn_1', role: 'superadmin' })));
    expect(user).toEqual({ id: 'prn_1', email: '', displayName: '', role: 'reader' });
  });

  it('passes through a valid role and profile fields', () => {
    const user = getSessionUser(
      fakeContext(fakeSession({ userId: 'prn_2', email: 'a@b.c', displayName: 'Ann', role: 'admin' })),
    );
    expect(user).toEqual({ id: 'prn_2', email: 'a@b.c', displayName: 'Ann', role: 'admin' });
  });
});

describe('requireAuth middleware', () => {
  it('throws UnauthorizedError when there is no authenticated session', async () => {
    const mw = requireAuth();
    const next = async () => {};
    await expect(mw(fakeContext(), next)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('sets the user in context and calls next when authenticated', async () => {
    const c = fakeContext(fakeSession({ userId: 'prn_9', role: 'editor' }));
    let called = false;
    const mw = requireAuth();
    await mw(c, async () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(getUser(c)).toEqual({ id: 'prn_9', email: '', displayName: '', role: 'editor' });
  });
});
