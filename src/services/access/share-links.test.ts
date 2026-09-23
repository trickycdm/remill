/**
 * Share-link service tests (D51): password creation, the openShareLink
 * locked/open state machine, unlockShareLink, and listShareLinks/
 * revokeShareLink gating.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import {
  createShareLink,
  openShareLink,
  unlockShareLink,
  listShareLinks,
  revokeShareLink,
  grantItem,
  emailShareLink,
} from '@/services/access';
import { seedRoles, makePrincipal } from '@/test/access';
import { InputValidationError, ForbiddenError, NotFoundError } from '@/lib/errors';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import type { EmailTransport } from '@/lib/email';
import * as grantQ from '@/db/queries/grants';

const NOW = '2026-09-23T12:00:00Z';
const SECRET = 's'.repeat(32);
const BASE_URL = 'https://example.org';

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

describe('share-link service (D51)', () => {
  let db: Database;
  let admin: Principal;
  let editor: Principal;
  let author: Principal;
  let reader: Principal;
  let docId: string;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    editor = await makePrincipal(db, NOW, { id: 'prn_editor', role: 'editor' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    await collectionsService.createCollection(db, admin, NOTES, NOW);
    docId = (await docs.createDocument(db, admin, 'notes', { title: 'Linkable' }, NOW)).id;
  });

  describe('createShareLink', () => {
    it('creates a plain link with hasPassword: false', async () => {
      const link = await createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'] }, SECRET, NOW);
      expect(link.hasPassword).toBe(false);
      expect(link.label).toBeNull();
      expect(link.token).toBeTruthy();
    });

    it('hashes a password (min 8 chars) and never returns the plaintext or hash', async () => {
      const link = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
        SECRET, NOW,
      );
      expect(link.hasPassword).toBe(true);
      expect(JSON.stringify(link)).not.toContain('hunter22');
    });

    it('rejects a password shorter than 8 characters', async () => {
      await expect(
        createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'], password: 'short' }, SECRET, NOW),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('trims and caps the label at 80 characters', async () => {
      const long = '  ' + 'x'.repeat(200) + '  ';
      const link = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], label: long },
        SECRET, NOW,
      );
      expect(link.label).toHaveLength(80);
      expect(link.label?.startsWith('x')).toBe(true);
    });

    it('denies a reader (no share_link permission)', async () => {
      await expect(
        createShareLink(db, reader, { collection: 'notes', documentId: docId, actions: ['read'] }, SECRET, NOW),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('D51 review finding 3: rejects a junk expiresAt instead of minting a never-expiring link', async () => {
      await expect(
        createShareLink(
          db,
          editor,
          { collection: 'notes', documentId: docId, actions: ['read'], expiresAt: 'not-a-real-date' },
          SECRET, NOW,
        ),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('finding 3: maxTtlDays makes expiresAt required', async () => {
      await expect(
        createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'], maxTtlDays: 30 }, SECRET, NOW),
      ).rejects.toBeInstanceOf(InputValidationError);
    });

    it('finding 3: maxTtlDays clamps a far-out expiresAt and echoes the normalized value', async () => {
      const farFuture = new Date(new Date(NOW).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const link = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], expiresAt: farFuture, maxTtlDays: 30 },
        SECRET, NOW,
      );
      expect(link.expiresAt).not.toBeNull();
      const capped = new Date(NOW).getTime() + 30 * 24 * 60 * 60 * 1000;
      expect(new Date(link.expiresAt!).getTime()).toBe(capped);
    });

    it('finding 3: without maxTtlDays (the admin panel), expiresAt stays open-ended when omitted', async () => {
      const link = await createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'] }, SECRET, NOW);
      expect(link.expiresAt).toBeNull();
    });
  });

  describe('openShareLink', () => {
    it('returns open immediately for a link with no password', async () => {
      const { token } = await createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'] }, SECRET, NOW);
      const resolved = await openShareLink(db, token, undefined, SECRET, NOW);
      expect(resolved?.state).toBe('open');
    });

    it('returns null for an unknown token', async () => {
      expect(await openShareLink(db, 'rms_nope', undefined, SECRET, NOW)).toBeNull();
    });

    it('returns locked for a password link with no cookie', async () => {
      const { token } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
        SECRET, NOW,
      );
      const resolved = await openShareLink(db, token, undefined, SECRET, NOW);
      expect(resolved?.state).toBe('locked');
    });

    it('returns open once unlocked, and locked again with a tampered cookie', async () => {
      const { token } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
        SECRET, NOW,
      );
      const unlock = await unlockShareLink(db, token, 'hunter22', SECRET, NOW);
      expect(unlock.ok).toBe(true);
      if (!unlock.ok) throw new Error('unreachable');

      const opened = await openShareLink(db, token, unlock.cookieValue, SECRET, NOW);
      expect(opened?.state).toBe('open');

      // Deterministically flip the LAST character rather than always
      // substituting '0' — that left the value unchanged (and the assertion
      // vacuous) whenever the real last character already WAS '0' (1-in-16,
      // D51 review finding 21).
      const last = unlock.cookieValue.slice(-1);
      const flipped = last === '0' ? '1' : '0';
      const tampered = await openShareLink(db, token, `${unlock.cookieValue.slice(0, -1)}${flipped}`, SECRET, NOW);
      expect(tampered?.state).toBe('locked');
    });

    it('rejects an unlock cookie once its embedded expiry has passed, even with a valid signature', async () => {
      const { token } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
        SECRET, NOW,
      );
      const unlock = await unlockShareLink(db, token, 'hunter22', SECRET, NOW);
      if (!unlock.ok) throw new Error('unreachable');
      const wayLater = new Date(new Date(NOW).getTime() + (unlock.maxAgeSeconds + 60) * 1000).toISOString();
      const resolved = await openShareLink(db, token, unlock.cookieValue, SECRET, wayLater);
      expect(resolved?.state).toBe('locked');
    });

    it('invalidates an unlock cookie when the link is revoked and RE-MINTED — the new grant has a different id and hash', async () => {
      const { token, grantId } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
        SECRET, NOW,
      );
      const unlock = await unlockShareLink(db, token, 'hunter22', SECRET, NOW);
      if (!unlock.ok) throw new Error('unreachable');

      await revokeShareLink(db, editor, 'notes', docId, grantId, NOW);
      // The old cookie is already dead (the grant it names is gone).
      expect(await openShareLink(db, token, unlock.cookieValue, SECRET, NOW)).toBeNull();

      // Actually re-mint: a NEW link, same password, same document — different
      // grant id and (freshly salted) password hash. The OLD cookie must not
      // unlock the new grant even if presented against its (different) token.
      const reMinted = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
        SECRET, NOW,
      );
      expect(reMinted.grantId).not.toBe(grantId);
      const resolved = await openShareLink(db, reMinted.token, unlock.cookieValue, SECRET, NOW);
      expect(resolved?.state).toBe('locked');
    });
  });

  describe('unlockShareLink', () => {
    it('fails for a wrong password', async () => {
      const { token } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22' },
        SECRET, NOW,
      );
      const result = await unlockShareLink(db, token, 'wrongpass', SECRET, NOW);
      expect(result.ok).toBe(false);
    });

    it('fails for an unknown token', async () => {
      expect((await unlockShareLink(db, 'rms_nope', 'whatever1', SECRET, NOW)).ok).toBe(false);
    });

    it('fails for a link with no password set', async () => {
      const { token } = await createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'] }, SECRET, NOW);
      expect((await unlockShareLink(db, token, 'whatever1', SECRET, NOW)).ok).toBe(false);
    });

    it('caps maxAge at 24h even for a further-out expiry, and at the expiry when sooner', async () => {
      const farFuture = new Date(new Date(NOW).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { token: farToken } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22', expiresAt: farFuture },
        SECRET, NOW,
      );
      const farUnlock = await unlockShareLink(db, farToken, 'hunter22', SECRET, NOW);
      if (!farUnlock.ok) throw new Error('unreachable');
      expect(farUnlock.maxAgeSeconds).toBe(24 * 60 * 60);

      const soon = new Date(new Date(NOW).getTime() + 60_000).toISOString(); // 60s out
      const { token: soonToken } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'], password: 'hunter22', expiresAt: soon },
        SECRET, NOW,
      );
      const soonUnlock = await unlockShareLink(db, soonToken, 'hunter22', SECRET, NOW);
      if (!soonUnlock.ok) throw new Error('unreachable');
      expect(soonUnlock.maxAgeSeconds).toBeLessThanOrEqual(60);
    });
  });

  describe('D51 review finding 1: cross-collection document impersonation is a 404', () => {
    const OTHER: CollectionDefinition = {
      slug: 'other',
      name: 'Other',
      shape: 'collection',
      fields: [{ key: 'title', type: 'text', required: true, index: true }],
      workflow: { draftPublish: true },
    };

    it('createShareLink refuses to mint a link naming the WRONG collection for a real document', async () => {
      await collectionsService.createCollection(db, admin, OTHER, NOW);
      const otherDocId = (await docs.createDocument(db, admin, 'other', { title: 'Elsewhere' }, NOW)).id;
      // editor holds share_link on 'notes', not 'other' — but the exploit is
      // claiming the OTHER document lives in 'notes' (a collection editor DOES
      // hold share_link on), not merely trying 'other' directly.
      await expect(
        createShareLink(db, editor, { collection: 'notes', documentId: otherDocId, actions: ['read'] }, SECRET, NOW),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('grantItem refuses to grant against a document that actually lives in a different collection', async () => {
      await collectionsService.createCollection(db, admin, OTHER, NOW);
      const otherDocId = (await docs.createDocument(db, admin, 'other', { title: 'Elsewhere' }, NOW)).id;
      await expect(
        grantItem(
          db,
          admin,
          { subjectKind: 'principal', subjectId: reader.id, documentId: otherDocId, collection: 'notes', actions: ['read'] },
          NOW,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('listShareLinks / revokeShareLink gating', () => {
    it('an editor can list and revoke', async () => {
      const { grantId } = await createShareLink(db, editor, { collection: 'notes', documentId: docId, actions: ['read'] }, SECRET, NOW);
      const links = await listShareLinks(db, editor, 'notes', docId, SECRET, BASE_URL, NOW);
      expect(links.some((l) => l.id === grantId)).toBe(true);
      await revokeShareLink(db, editor, 'notes', docId, grantId, NOW);
      const after = await listShareLinks(db, editor, 'notes', docId, SECRET, BASE_URL, NOW);
      expect(after.some((l) => l.id === grantId)).toBe(false);
    });

    it('an author is denied (no share_link permission)', async () => {
      await expect(listShareLinks(db, author, 'notes', docId, SECRET, BASE_URL, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('a reader is denied', async () => {
      await expect(listShareLinks(db, reader, 'notes', docId, SECRET, BASE_URL, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('cannot revoke a non-link grant through revokeShareLink', async () => {
      const grantId = await grantItem(
        db,
        admin,
        { subjectKind: 'principal', subjectId: 'prn_author', documentId: docId, collection: 'notes', actions: ['read'] },
        NOW,
      );
      await expect(revokeShareLink(db, editor, 'notes', docId, grantId, NOW)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('emailShareLink (D51 review finding 2)', () => {
    function fakeTransport(): EmailTransport & { sent: { to: string }[] } {
      const sent: { to: string }[] = [];
      return {
        kind: 'console',
        sent,
        async send(msg) {
          sent.push({ to: msg.to });
        },
      };
    }

    it('a reader (no share_link permission) is denied — never a bare "logged in" check', async () => {
      const transport = fakeTransport();
      await expect(
        emailShareLink(
          db,
          reader,
          { collection: 'notes', documentId: docId, url: `${BASE_URL}/s/rms_whatever`, email: 'a@b.com', baseUrl: BASE_URL },
          transport,
          undefined,
          NOW,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(transport.sent).toHaveLength(0);
    });

    it('rejects a url that is not exactly `${baseUrl}/s/<token>` for this install', async () => {
      const transport = fakeTransport();
      await expect(
        emailShareLink(
          db,
          editor,
          { collection: 'notes', documentId: docId, url: 'https://evil.example.com/s/rms_x', email: 'a@b.com', baseUrl: BASE_URL },
          transport,
          undefined,
          NOW,
        ),
      ).rejects.toBeInstanceOf(InputValidationError);
      // A startsWith check would also have let `${baseUrl}/s/../elsewhere` or an
      // appended path through — the exact `[A-Za-z0-9_-]+` token match doesn't.
      await expect(
        emailShareLink(
          db,
          editor,
          { collection: 'notes', documentId: docId, url: `${BASE_URL}/s/rms_x/../elsewhere`, email: 'a@b.com', baseUrl: BASE_URL },
          transport,
          undefined,
          NOW,
        ),
      ).rejects.toBeInstanceOf(InputValidationError);
      expect(transport.sent).toHaveLength(0);
    });

    it('rejects a malformed email address', async () => {
      const transport = fakeTransport();
      await expect(
        emailShareLink(
          db,
          editor,
          { collection: 'notes', documentId: docId, url: `${BASE_URL}/s/rms_x`, email: 'not-an-email', baseUrl: BASE_URL },
          transport,
          undefined,
          NOW,
        ),
      ).rejects.toBeInstanceOf(InputValidationError);
      expect(transport.sent).toHaveLength(0);
    });

    it('sends through the transport when authorized with a valid url + email', async () => {
      const transport = fakeTransport();
      await emailShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, url: `${BASE_URL}/s/rms_ABC_123-x`, email: 'someone@example.com', baseUrl: BASE_URL },
        transport,
        'My Site',
        NOW,
      );
      expect(transport.sent).toEqual([{ to: 'someone@example.com' }]);
    });
  });

  describe('listShareLinks url (D53 — reversible token storage)', () => {
    it('stores token_enc as ciphertext, never the plaintext token', async () => {
      const { grantId, token } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'] },
        SECRET,
        NOW,
      );
      const rows = await grantQ.listLinkGrantsForDocument(db, docId, NOW);
      const row = rows.find((r) => r.id === grantId);
      expect(row?.tokenEnc).toBeTruthy();
      expect(row?.tokenEnc).not.toContain(token);
    });

    it('returns a url that resolves back to the same grant via openShareLink', async () => {
      const { grantId } = await createShareLink(
        db,
        editor,
        { collection: 'notes', documentId: docId, actions: ['read'] },
        SECRET,
        NOW,
      );
      const links = await listShareLinks(db, editor, 'notes', docId, SECRET, BASE_URL, NOW);
      const link = links.find((l) => l.id === grantId);
      expect(link?.url).toMatch(new RegExp(`^${BASE_URL}/s/rms_`));
      const presentedToken = link!.url!.slice(`${BASE_URL}/s/`.length);
      const opened = await openShareLink(db, presentedToken, undefined, SECRET, NOW);
      expect(opened?.grant.id).toBe(grantId);
    });

    it('returns a null url for a legacy link (token_enc null — minted before D53)', async () => {
      const legacyId = await grantQ.createItemGrant(
        db,
        {
          subjectKind: 'link',
          subjectId: 'legacy_hash_no_token_enc',
          documentId: docId,
          actions: ['read'],
          grantedBy: editor.id,
          expiresAt: null,
          tokenEnc: null,
        },
        NOW,
      );
      const links = await listShareLinks(db, editor, 'notes', docId, SECRET, BASE_URL, NOW);
      const link = links.find((l) => l.id === legacyId);
      expect(link?.url).toBeNull();
    });

    it('gating is unchanged: a reader still cannot list links even with the url field added', async () => {
      await expect(listShareLinks(db, reader, 'notes', docId, SECRET, BASE_URL, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
