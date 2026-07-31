import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import { connectAgent, listTokens } from '@/services/access';
import { findTokenByHash, getPrincipal } from '@/db/queries/principals';
import { getPrincipalPermissions } from '@/db/queries/roles';
import { hashToken } from '@/lib/token';
import { principals } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/access';
import { ForbiddenError, InputValidationError } from '@/lib/errors';

const NOW = '2026-07-23T12:00:00Z';

describe('connectAgent — the one-step wizard service (D48)', () => {
  let db: Database;
  let admin: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
  });

  it('creates principal + role + token atomically; token resolves by hash', async () => {
    const result = await connectAgent(db, admin, { name: 'claude-code', role: 'editor' }, NOW);
    expect(result.token).toMatch(/^rmk_/);
    const agent = await getPrincipal(db, result.principalId);
    expect(agent?.kind).toBe('agent');
    expect(agent?.roles).toEqual([{ role: 'editor', collection: '*' }]);
    const row = await findTokenByHash(db, await hashToken(result.token));
    expect(row?.principalId).toBe(result.principalId);
    expect(row?.scope).toBeNull(); // full = inherit role, no narrowing mask
    const perms = await getPrincipalPermissions(db, result.principalId);
    expect(perms.some((p) => p.action === 'publish')).toBe(true);
  });

  it('carries an optional narrowing scope and collection-scoped role', async () => {
    const result = await connectAgent(
      db,
      admin,
      { name: 'reader-bot', role: 'reader', roleCollection: 'articles', scope: [{ collection: 'articles', action: 'read' }] },
      NOW,
    );
    const row = await findTokenByHash(db, await hashToken(result.token));
    expect(row?.scope).toEqual([{ collection: 'articles', action: 'read' }]);
    const agent = await getPrincipal(db, result.principalId);
    expect(agent?.roles).toEqual([{ role: 'reader', collection: 'articles' }]);
  });

  it('validation failures leave NO principal behind (atomicity)', async () => {
    await expect(connectAgent(db, admin, { name: '', role: 'editor' }, NOW)).rejects.toThrow(InputValidationError);
    await expect(connectAgent(db, admin, { name: 'x', role: 'no-such-role' }, NOW)).rejects.toThrow(InputValidationError);
    await expect(connectAgent(db, admin, { name: 'x', role: 'anonymous' }, NOW)).rejects.toThrow(InputValidationError);
    await expect(
      connectAgent(db, admin, { name: 'x', role: 'reader', scope: [{ collection: '*', action: 'fly' as never }] }, NOW),
    ).rejects.toThrow(InputValidationError);
    const agents = await db.select().from(principals).where(eq(principals.kind, 'agent'));
    expect(agents).toHaveLength(0);
  });

  it('SEC-8: agents and non-manage_access humans are refused', async () => {
    const bot = await makePrincipal(db, NOW, { id: 'prn_bot', kind: 'agent', role: 'admin', surface: 'mcp' });
    await expect(connectAgent(db, bot, { name: 'x', role: 'reader' }, NOW)).rejects.toThrow(ForbiddenError);
    const editor = await makePrincipal(db, NOW, { id: 'prn_ed', role: 'editor' });
    await expect(connectAgent(db, editor, { name: 'x', role: 'reader' }, NOW)).rejects.toThrow(ForbiddenError);
    // Unlike OAuth consent, the wizard MAY grant admin (sanctioned path).
    const result = await connectAgent(db, admin, { name: 'ops-bot', role: 'admin' }, NOW);
    expect(result.principalId).toMatch(/^prn_/);
  });

  it('token appears in the standard token list (one revocation model)', async () => {
    const result = await connectAgent(db, admin, { name: 'claude-code', role: 'editor' }, NOW);
    const tokens = await listTokens(db, admin, NOW, result.principalId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].name).toBe('claude-code token');
  });
});
