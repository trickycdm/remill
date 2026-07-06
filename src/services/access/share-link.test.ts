import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as access from '@/services/access';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { recentAudit } from '@/db/queries/audit';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { ForbiddenError } from '@/lib/errors';

const NOW = '2026-07-04T12:00:00Z';
const FUTURE = '2026-08-01T12:00:00Z';

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

describe('share_link action (D26) — grantable link-minting, agents included', () => {
  let db: Database;
  let admin: Principal;
  let docId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, NOTES, NOW);
    docId = (await docs.createDocument(db, admin, 'notes', { title: 'Linkable' }, NOW)).id;
  });

  it('an AGENT with a share_link-bearing role can mint; the mint is audited as share_link@mcp', async () => {
    const agent = await makePrincipal(db, NOW, { id: 'prn_bot', kind: 'agent', role: 'editor', surface: 'mcp' });
    const { grantId, token } = await access.createShareLink(
      db,
      agent,
      { collection: 'notes', documentId: docId, actions: ['read'], expiresAt: FUTURE },
      NOW,
    );
    expect(token).toMatch(/^rms_/);
    expect(grantId).toMatch(/^grn_/);

    // The link resolves and reads the doc as an anonymous link-holder.
    const grant = await access.resolveShareLink(db, token, NOW);
    expect(grant?.documentId).toBe(docId);

    // Audit: the allow row is self-describing (share_link over mcp).
    const audit = await recentAudit(db, 100);
    expect(audit.find((a) => a.action === 'share_link' && a.surface === 'mcp' && a.allowed === 1)).toBeTruthy();

    // …and revocation still works like any grant.
    await access.revokeItem(db, admin, grantId, 'notes', docId, NOW);
    expect(await access.resolveShareLink(db, token, NOW)).toBeNull();
  });

  it('an agent WITHOUT share_link is refused — and the deny is audited', async () => {
    const agent = await makePrincipal(db, NOW, { id: 'prn_reader_bot', kind: 'agent', role: 'reader', surface: 'mcp' });
    await expect(
      access.createShareLink(db, agent, { collection: 'notes', documentId: docId, actions: ['read'] }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const audit = await recentAudit(db, 100);
    expect(audit.find((a) => a.action === 'share_link' && a.allowed === 0)).toBeTruthy();
  });

  it('share_link is grantable on ONE document via an item grant (no role change)', async () => {
    const agent = await makePrincipal(db, NOW, { id: 'prn_scoped_bot', kind: 'agent', role: 'reader', surface: 'mcp' });
    await access.grantItem(
      db,
      admin,
      { subjectKind: 'principal', subjectId: agent.id, documentId: docId, collection: 'notes', actions: ['share_link'] },
      NOW,
    );

    const { token } = await access.createShareLink(db, agent, { collection: 'notes', documentId: docId, actions: ['read'] }, NOW);
    expect(token).toMatch(/^rms_/);

    // The grant is document-scoped: another doc still refuses.
    const other = await docs.createDocument(db, admin, 'notes', { title: 'Other' }, NOW);
    await expect(
      access.createShareLink(db, agent, { collection: 'notes', documentId: other.id, actions: ['read'] }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('humans keep working: admin and editor roles hold share_link out of the box', async () => {
    const editor = await makePrincipal(db, NOW, { id: 'prn_ed', role: 'editor' });
    await expect(
      access.createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'] }, NOW),
    ).resolves.toBeTruthy();
    await expect(
      access.createShareLink(db, admin, { collection: 'notes', documentId: docId, actions: ['read'] }, NOW),
    ).resolves.toBeTruthy();
  });
});
