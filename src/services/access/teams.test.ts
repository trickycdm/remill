import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { authenticateUser } from '@/services/auth';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { ForbiddenError, InputValidationError, ConflictError, NotFoundError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';
const LATER = '2026-07-05T12:00:00Z';
const FUTURE = '2026-08-01T12:00:00Z';

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } }],
  workflow: { draftPublish: true },
};

describe('teams (D24) — grant subject kind + membership + join links', () => {
  let db: Database;
  let admin: Principal;
  let member: Principal;
  let outsider: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    member = await makePrincipal(db, NOW, { id: 'prn_member', role: 'reader' });
    outsider = await makePrincipal(db, NOW, { id: 'prn_outsider', role: 'reader' });
    await collectionsService.createCollection(db, admin, NOTES, NOW);
  });

  it('team CRUD + membership is manage_access-gated and refuses agents (SEC-8)', async () => {
    const editor = await makePrincipal(db, NOW, { id: 'prn_editor', role: 'editor' });
    await expect(access.createTeam(db, editor, { name: 'x' }, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    const agentAdmin = await makePrincipal(db, NOW, { id: 'prn_agent', kind: 'agent', role: 'admin' });
    await expect(access.createTeam(db, agentAdmin, { name: 'x' }, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    const teamId = await access.createTeam(db, admin, { name: 'Tech team' }, NOW);
    await expect(access.addTeamMember(db, agentAdmin, teamId, member.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      access.createTeamInvite(db, agentAdmin, { teamId, expiresAt: FUTURE }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Unknown targets are structured 404s, not silent no-ops.
    await expect(access.addTeamMember(db, admin, 'tem_missing', member.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(access.addTeamMember(db, admin, teamId, 'prn_missing', NOW)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a team grant lets members (and only members) read one draft document', async () => {
    const teamId = await access.createTeam(db, admin, { name: 'Tech team' }, NOW);
    await access.addTeamMember(db, admin, teamId, member.id, NOW);

    const doc = await docs.createDocument(db, admin, 'notes', { title: 'Secret draft' }, NOW);
    // Draft + reader role → invisible before the grant.
    await expect(docs.getDocument(db, member, 'notes', doc.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    await access.grantItem(
      db,
      admin,
      { subjectKind: 'team', subjectId: teamId, documentId: doc.id, collection: 'notes', actions: ['read'] },
      NOW,
    );

    const seen = await docs.getDocument(db, member, 'notes', doc.id, NOW);
    expect(seen.data.title).toBe('Secret draft');
    // …and it appears in the member's LIST view (compiled filter widens by grant).
    const listed = await docs.listDocuments(db, member, 'notes', {}, NOW);
    expect(listed.rows.map((d) => d.id)).toContain(doc.id);

    // A non-member with the same role sees nothing.
    await expect(docs.getDocument(db, outsider, 'notes', doc.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const outsiderList = await docs.listDocuments(db, outsider, 'notes', {}, NOW);
    expect(outsiderList.rows.map((d) => d.id)).not.toContain(doc.id);

    // Leaving the team removes the access.
    await access.removeTeamMember(db, admin, teamId, member.id, NOW);
    await expect(docs.getDocument(db, member, 'notes', doc.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('expired team grants confer nothing; deleteTeam revokes its grants', async () => {
    const teamId = await access.createTeam(db, admin, { name: 'Tech team' }, NOW);
    await access.addTeamMember(db, admin, teamId, member.id, NOW);
    const doc = await docs.createDocument(db, admin, 'notes', { title: 'Ephemeral' }, NOW);

    await access.grantItem(
      db,
      admin,
      { subjectKind: 'team', subjectId: teamId, documentId: doc.id, collection: 'notes', actions: ['read'], expiresAt: LATER },
      NOW,
    );
    await expect(docs.getDocument(db, member, 'notes', doc.id, NOW)).resolves.toBeTruthy();
    // Past the expiry, the same read is denied.
    await expect(docs.getDocument(db, member, 'notes', doc.id, FUTURE)).rejects.toBeInstanceOf(ForbiddenError);

    // A fresh grant, then the team is deleted → grant revoked with it.
    await access.grantItem(
      db,
      admin,
      { subjectKind: 'team', subjectId: teamId, documentId: doc.id, collection: 'notes', actions: ['read'] },
      NOW,
    );
    await access.deleteTeam(db, admin, teamId, NOW);
    await expect(docs.getDocument(db, member, 'notes', doc.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('listSharedWithMe surfaces team-shared docs with actions + expiry', async () => {
    const teamId = await access.createTeam(db, admin, { name: 'Tech team' }, NOW);
    await access.addTeamMember(db, admin, teamId, member.id, NOW);
    const doc = await docs.createDocument(db, admin, 'notes', { title: 'Shared note' }, NOW);
    await access.grantItem(
      db,
      admin,
      { subjectKind: 'team', subjectId: teamId, documentId: doc.id, collection: 'notes', actions: ['read'], expiresAt: FUTURE },
      NOW,
    );

    const mine = await docs.listSharedWithMe(db, member, NOW);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: doc.id, collection: 'notes', title: 'Shared note', expiresAt: FUTURE });
    expect(mine[0].actions).toContain('read');

    expect(await docs.listSharedWithMe(db, outsider, NOW)).toHaveLength(0);
  });

  it('join links: happy path creates the account, assigns the preset role, joins the team', async () => {
    const teamId = await access.createTeam(db, admin, { name: 'Tech team' }, NOW);
    const { token } = await access.createTeamInvite(db, admin, { teamId, role: 'author', expiresAt: FUTURE }, NOW);
    expect(token).toMatch(/^rmj_/);
    expect(await access.teamInviteIsValid(db, token, NOW)).toBe(true);

    const { principalId } = await access.acceptTeamInvite(
      db,
      token,
      { name: 'Stu', email: 'Stu@Example.com', password: 'password1' },
      NOW,
    );

    // Signs in with the normalized email…
    expect((await authenticateUser(db, 'stu@example.com', 'password1'))?.id).toBe(principalId);
    // …holds the preset role…
    const listed = await access.listPrincipals(db, admin, NOW);
    expect(listed.find((p) => p.id === principalId)?.roles.map((r) => r.role)).toContain('author');
    // …and is a team member.
    const members = await access.listTeamMembers(db, admin, teamId, NOW);
    expect(members.map((m) => m.principalId)).toContain(principalId);
  });

  it('join links: invalid role / past expiry rejected at mint; expiry clamped to 90 days', async () => {
    const teamId = await access.createTeam(db, admin, { name: 'T' }, NOW);
    await expect(
      access.createTeamInvite(db, admin, { teamId, role: 'anonymous', expiresAt: FUTURE }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      access.createTeamInvite(db, admin, { teamId, role: 'nope', expiresAt: FUTURE }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(access.createTeamInvite(db, admin, { teamId, expiresAt: NOW }, NOW)).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(
      access.createTeamInvite(db, admin, { teamId, maxUses: 0, expiresAt: FUTURE }, NOW),
    ).rejects.toBeInstanceOf(InputValidationError);

    // A far-future expiry is clamped: the link dies within 90 days.
    const { token } = await access.createTeamInvite(db, admin, { teamId, expiresAt: '2036-01-01T00:00:00Z' }, NOW);
    expect(await access.teamInviteIsValid(db, token, '2026-10-03T12:00:00Z')).toBe(false); // > 90d after NOW
  });

  it('join links: revoked / expired / used-up / unknown all refuse alike; duplicate email conflicts', async () => {
    const teamId = await access.createTeam(db, admin, { name: 'T' }, NOW);
    const reg = { name: 'P', email: 'p@example.com', password: 'password1' };

    // Unknown token.
    await expect(access.acceptTeamInvite(db, 'rmj_bogus', reg, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    // Expired.
    const expired = await access.createTeamInvite(db, admin, { teamId, expiresAt: LATER }, NOW);
    await expect(access.acceptTeamInvite(db, expired.token, reg, FUTURE)).rejects.toBeInstanceOf(ForbiddenError);

    // Revoked.
    const revoked = await access.createTeamInvite(db, admin, { teamId, expiresAt: FUTURE }, NOW);
    await access.revokeTeamInvite(db, admin, revoked.inviteId, NOW);
    await expect(access.acceptTeamInvite(db, revoked.token, reg, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    // maxUses: one seat — the second registration is refused.
    const seat = await access.createTeamInvite(db, admin, { teamId, maxUses: 1, expiresAt: FUTURE }, NOW);
    await access.acceptTeamInvite(db, seat.token, { name: 'One', email: 'one@example.com', password: 'password1' }, NOW);
    await expect(
      access.acceptTeamInvite(db, seat.token, { name: 'Two', email: 'two@example.com', password: 'password1' }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // An existing email must never be silently attached to a team.
    const dupe = await access.createTeamInvite(db, admin, { teamId, expiresAt: FUTURE }, NOW);
    await access.acceptTeamInvite(db, dupe.token, { name: 'New', email: 'fresh@example.com', password: 'password1' }, NOW);
    await expect(
      access.acceptTeamInvite(db, dupe.token, { name: 'Again', email: 'Fresh@example.com', password: 'password1' }, NOW),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
