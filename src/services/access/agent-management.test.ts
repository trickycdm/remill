import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { findTokenByHash, getPrincipal, insertToken, isPrincipalActive, listTokens } from '@/db/queries/principals';
import { insertClient, createGrantWithPrincipal } from '@/db/queries/oauth';
import { hashToken } from '@/lib/token';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { ConflictError, ForbiddenError, InputValidationError, NotFoundError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

describe('agent management — token re-scope, rename, disable, delete', () => {
  let db: Database;
  let admin: Principal;
  let agentId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    agentId = await access.createAgent(db, admin, 'bot', NOW);
    await access.assignRole(db, admin, agentId, 'editor', '*', NOW);
  });

  describe('updateTokenScope', () => {
    it('narrows a token in place, then clears it back to full access — same token keeps working', async () => {
      const { id, token } = await access.issueToken(db, admin, { principalId: agentId, name: 'prod' }, NOW);

      await access.updateTokenScope(db, admin, id, [{ collection: 'notes', action: 'read' }], NOW);
      expect((await findTokenByHash(db, await hashToken(token)))?.scope).toEqual([{ collection: 'notes', action: 'read' }]);

      await access.updateTokenScope(db, admin, id, undefined, NOW);
      expect((await findTokenByHash(db, await hashToken(token)))?.scope).toBeNull();
    });

    it('rejects unknown actions and unknown tokens', async () => {
      const { id } = await access.issueToken(db, admin, { principalId: agentId, name: 'prod' }, NOW);
      await expect(
        access.updateTokenScope(db, admin, id, [{ collection: '*', action: 'root' as never }], NOW),
      ).rejects.toBeInstanceOf(InputValidationError);
      await expect(access.updateTokenScope(db, admin, 'tok_missing', undefined, NOW)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('refuses OAuth-minted tokens — their scope is the consent', async () => {
      const clientId = await insertClient(db, { name: 'Client', redirectUris: ['http://localhost/cb'] }, NOW);
      const { grantId, principalId } = await createGrantWithPrincipal(
        db,
        { clientId, principalName: 'oauth-bot', grantedBy: admin.id, role: 'editor', resource: null, code: null },
        NOW,
      );
      const tokenId = await insertToken(db, {
        principalId,
        name: 'oauth',
        tokenHash: await hashToken('rmo_x'),
        scope: null,
        expiresAt: null,
        now: NOW,
        grantId,
      });
      expect((await listTokens(db, principalId))[0]?.oauth).toBe(true);
      await expect(access.updateTokenScope(db, admin, tokenId, undefined, NOW)).rejects.toBeInstanceOf(ConflictError);
    });

    it('SEC-8: an agent cannot re-scope tokens, even with manage_access', async () => {
      const { id } = await access.issueToken(db, admin, { principalId: agentId, name: 'prod' }, NOW);
      const agentAdmin = await makePrincipal(db, NOW, { id: 'prn_agent_admin', kind: 'agent', role: 'admin', surface: 'mcp' });
      await expect(access.updateTokenScope(db, agentAdmin, id, undefined, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('renameAgent', () => {
    it('renames the agent, trimmed, and its token keeps working', async () => {
      const { token } = await access.issueToken(db, admin, { principalId: agentId, name: 'prod' }, NOW);
      await access.renameAgent(db, admin, agentId, '  release-notes-bot  ', NOW);
      expect((await getPrincipal(db, agentId))?.name).toBe('release-notes-bot');
      expect(await findTokenByHash(db, await hashToken(token))).not.toBeNull();
    });

    it('refuses a blank or overlong name without changing it', async () => {
      await expect(access.renameAgent(db, admin, agentId, '   ', NOW)).rejects.toBeInstanceOf(InputValidationError);
      await expect(access.renameAgent(db, admin, agentId, 'x'.repeat(101), NOW)).rejects.toBeInstanceOf(InputValidationError);
      expect((await getPrincipal(db, agentId))?.name).toBe('bot');
    });

    it('refuses people, unknown principals, and agent callers', async () => {
      await expect(access.renameAgent(db, admin, admin.id, 'x', NOW)).rejects.toBeInstanceOf(InputValidationError);
      await expect(access.renameAgent(db, admin, 'prn_missing', 'x', NOW)).rejects.toBeInstanceOf(NotFoundError);
      const agentAdmin = await makePrincipal(db, NOW, { id: 'prn_agent_admin', kind: 'agent', role: 'admin', surface: 'mcp' });
      await expect(access.renameAgent(db, agentAdmin, agentId, 'x', NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('setAgentDisabled', () => {
    it('disables and re-enables a machine principal', async () => {
      await access.setAgentDisabled(db, admin, agentId, true, NOW);
      expect(await isPrincipalActive(db, agentId)).toBe(false);
      await access.setAgentDisabled(db, admin, agentId, false, NOW);
      expect(await isPrincipalActive(db, agentId)).toBe(true);
    });

    it('refuses people, unknown principals, and agent callers', async () => {
      await expect(access.setAgentDisabled(db, admin, admin.id, true, NOW)).rejects.toBeInstanceOf(InputValidationError);
      await expect(access.setAgentDisabled(db, admin, 'prn_missing', true, NOW)).rejects.toBeInstanceOf(NotFoundError);
      const agentAdmin = await makePrincipal(db, NOW, { id: 'prn_agent_admin', kind: 'agent', role: 'admin', surface: 'mcp' });
      await expect(access.setAgentDisabled(db, agentAdmin, agentId, true, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('deleteAgent', () => {
    it('removes the agent with its tokens, roles, and item grants', async () => {
      await collectionsService.createCollection(db, admin, NOTES, NOW);
      const docId = (await docs.createDocument(db, admin, 'notes', { title: 'Shared' }, NOW)).id;
      await access.grantItem(
        db,
        admin,
        { subjectKind: 'principal', subjectId: agentId, documentId: docId, collection: 'notes', actions: ['read'] },
        NOW,
      );
      const { token } = await access.issueToken(db, admin, { principalId: agentId, name: 'prod' }, NOW);

      await access.deleteAgent(db, admin, agentId, NOW);

      expect(await getPrincipal(db, agentId)).toBeNull();
      expect(await findTokenByHash(db, await hashToken(token))).toBeNull();
      expect(await access.listItemGrants(db, admin, 'notes', docId, NOW)).toEqual([]);
    });

    it('refuses while the agent is the recorded author of content', async () => {
      await collectionsService.createCollection(db, admin, NOTES, NOW);
      const author: Principal = { id: agentId, kind: 'agent', surface: 'mcp' };
      await docs.createDocument(db, author, 'notes', { title: 'Mine' }, NOW);

      await expect(access.deleteAgent(db, admin, agentId, NOW)).rejects.toBeInstanceOf(ConflictError);
      expect(await getPrincipal(db, agentId)).not.toBeNull();
    });

    it('refuses people and agent callers', async () => {
      await expect(access.deleteAgent(db, admin, admin.id, NOW)).rejects.toBeInstanceOf(InputValidationError);
      const agentAdmin = await makePrincipal(db, NOW, { id: 'prn_agent_admin', kind: 'agent', role: 'admin', surface: 'mcp' });
      await expect(access.deleteAgent(db, agentAdmin, agentId, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});

describe('getPrincipalDetail', () => {
  let db: Database;
  let admin: Principal;
  let agentId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    agentId = await access.createAgent(db, admin, 'bot', NOW);
  });

  it('returns the principal, its tokens, and how much content it authored', async () => {
    await access.assignRole(db, admin, agentId, 'editor', '*', NOW);
    await access.issueToken(db, admin, { principalId: agentId, name: 'prod' }, NOW);
    await collectionsService.createCollection(db, admin, NOTES, NOW);
    await docs.createDocument(db, { id: agentId, kind: 'agent', surface: 'mcp' }, 'notes', { title: 'Mine' }, NOW);

    const detail = await access.getPrincipalDetail(db, admin, agentId, NOW);
    expect(detail.principal.name).toBe('bot');
    expect(detail.tokens.map((t) => t.name)).toEqual(['prod']);
    expect(detail.authored).toBeGreaterThan(0);
  });

  it('refuses unknown principals and callers without manage_access', async () => {
    await expect(access.getPrincipalDetail(db, admin, 'prn_missing', NOW)).rejects.toBeInstanceOf(NotFoundError);
    const reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    await expect(access.getPrincipalDetail(db, reader, agentId, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
