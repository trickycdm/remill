import { describe, it, expect, beforeEach } from 'vitest';
import type { Context } from 'hono';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { resolvePrincipal } from '@/lib/api-auth';
import {
  createAgentPrincipal,
  insertToken,
  listTokens,
  setPrincipalDisabled,
} from '@/db/queries/principals';
import { hashToken } from '@/lib/token';
import { UnauthorizedError } from '@/lib/errors';

/**
 * SEC-7: `last_used_at` must be stamped ONLY after a token passes the validity
 * (not-expired) and principal-active checks — never on a mere hash match. These
 * tests drive resolvePrincipal and assert the stamp is present iff auth succeeded.
 */

const NOW = '2026-07-04T12:00:00Z';
const PAST = '2026-07-01T00:00:00Z';

function ctxWithBearer(token: string): Context {
  return {
    req: { header: (k: string) => (k.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) },
  } as unknown as Context;
}

async function seedToken(
  db: Database,
  opts: { plain: string; expiresAt: string | null; disabled?: boolean },
): Promise<string> {
  const principalId = await createAgentPrincipal(db, 'bot', NOW);
  if (opts.disabled) await setPrincipalDisabled(db, principalId, true);
  await insertToken(db, {
    principalId,
    name: 'token',
    tokenHash: await hashToken(opts.plain),
    scope: null,
    expiresAt: opts.expiresAt,
    now: NOW,
  });
  return principalId;
}

describe('resolvePrincipal — token last_used_at ordering (SEC-7)', () => {
  let db: Database;

  beforeEach(() => {
    db = getDb(createTestD1());
  });

  it('does NOT stamp last_used_at when the token is expired', async () => {
    const pid = await seedToken(db, { plain: 'rmk_expired', expiresAt: PAST });
    await expect(resolvePrincipal(db, ctxWithBearer('rmk_expired'), 'rest', NOW)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const [token] = await listTokens(db, pid);
    expect(token.lastUsedAt).toBeNull(); // rejected → never stamped
  });

  it('does NOT stamp last_used_at when the principal is disabled', async () => {
    const pid = await seedToken(db, { plain: 'rmk_disabled', expiresAt: null, disabled: true });
    await expect(resolvePrincipal(db, ctxWithBearer('rmk_disabled'), 'rest', NOW)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const [token] = await listTokens(db, pid);
    expect(token.lastUsedAt).toBeNull();
  });

  it('DOES stamp last_used_at once a valid token + active principal pass the checks', async () => {
    const pid = await seedToken(db, { plain: 'rmk_good', expiresAt: null });
    const principal = await resolvePrincipal(db, ctxWithBearer('rmk_good'), 'rest', NOW);
    expect(principal.id).toBe(pid);
    const [token] = await listTokens(db, pid);
    expect(token.lastUsedAt).toBe(NOW);
  });

  it('returns the anonymous principal when no bearer token is presented', async () => {
    const ctx = { req: { header: () => undefined } } as unknown as Context;
    const principal = await resolvePrincipal(db, ctx, 'rest', NOW);
    expect(principal.id).toBe('anonymous');
  });
});
