import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import { findTokenByHash } from '@/db/queries/principals';
import { hashToken } from '@/lib/token';
import type { Principal } from '@/access';
import { ForbiddenError, InputValidationError, ConflictError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';

describe('access service — principals, roles, tokens', () => {
  let db: Database;
  let admin: Principal;
  let editor: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    editor = await makePrincipal(db, NOW, { id: 'prn_ed', role: 'editor' }); // lacks manage_access
  });

  it('creates an agent principal, assigns a role, and lists it', async () => {
    const agentId = await access.createAgent(db, admin, 'researcher-bot', NOW);
    await access.assignRole(db, admin, agentId, 'author', '*', NOW);
    const principals = await access.listPrincipals(db, admin, NOW);
    const agent = principals.find((p) => p.id === agentId);
    expect(agent?.kind).toBe('agent');
    expect(agent?.roles.map((r) => r.role)).toContain('author');
  });

  it('denies management to a principal without manage_access', async () => {
    await expect(access.createAgent(db, editor, 'x', NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(access.listAudit(db, editor, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('SEC-8: an AGENT principal cannot assign roles or mint tokens — even with manage_access', async () => {
    // An agent granted the admin role (which includes manage_access) must STILL be
    // structurally refused access-management mutations: no self-escalation, no
    // minting tokens for others.
    const agentAdmin = await makePrincipal(db, NOW, { id: 'prn_agent_admin', kind: 'agent', role: 'admin' });
    const target = await access.createAgent(db, admin, 'victim-bot', NOW);

    await expect(access.assignRole(db, agentAdmin, target, 'admin', '*', NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      access.issueToken(db, agentAdmin, { principalId: target, name: 'stolen' }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('issues a token: returns plaintext once, stores only the hash, resolves back', async () => {
    const agentId = await access.createAgent(db, admin, 'bot', NOW);
    const { token } = await access.issueToken(
      db,
      admin,
      { principalId: agentId, name: 'prod', scope: [{ collection: '*', action: 'read' }] },
      NOW,
    );
    expect(token).toMatch(/^rmk_/);

    // The stored row is the HASH, and it resolves to the principal + scope.
    const resolved = await findTokenByHash(db, await hashToken(token), NOW);
    expect(resolved?.principalId).toBe(agentId);
    expect(resolved?.scope).toEqual([{ collection: '*', action: 'read' }]);

    // A wrong token never resolves.
    expect(await findTokenByHash(db, await hashToken('rmk_wrong'), NOW)).toBeNull();

    // The token appears in the list (metadata only, no plaintext/hash leaked to UI).
    const tokens = await access.listTokens(db, admin, NOW, agentId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).not.toHaveProperty('token');
  });

  it('custom roles: create + validate closed vocab; system roles are protected', async () => {
    await access.createRole(
      db,
      admin,
      { slug: 'moderator', name: 'Moderator', description: 'Publish only', permissions: [{ collection: '*', action: 'publish' }] },
      NOW,
    );
    const roles = await access.listRoles(db);
    expect(roles.find((r) => r.slug === 'moderator')?.system).toBe(false);

    // Unknown action rejected.
    await expect(
      access.createRole(db, admin, { slug: 'bad', name: 'Bad', description: '', permissions: [{ collection: '*', action: 'teleport' as never }] }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);

    // Reserved system slug rejected.
    await expect(
      access.createRole(db, admin, { slug: 'admin', name: 'x', description: '', permissions: [] }, NOW),
    ).rejects.toBeInstanceOf(ConflictError);

    // System role cannot be modified/deleted.
    await expect(access.updateRole(db, admin, 'admin', 'x', undefined, [], NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(access.deleteRole(db, admin, 'editor', NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
