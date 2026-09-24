import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import * as comments from '@/services/comments';
import { createShareLink, openShareLink, revokeShareLink, grantItem } from '@/services/access';
import { recentAudit } from '@/db/queries/audit';
import type { Principal } from '@/access';
import { seedRoles, makePrincipal } from '@/test/access';
import type { CollectionDefinition } from '@/fields/types';
import { ForbiddenError, NotFoundError, InputValidationError, BadRequestError } from '@/lib/errors';
import type { CommentRecord } from '@/db/queries/comments';

const NOW = '2026-09-23T12:00:00Z';
const SECRET = 's'.repeat(32);

const DOCS: CollectionDefinition = {
  slug: 'reports',
  name: 'Reports',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true },
    { key: 'page', type: 'html' },
  ],
  workflow: { draftPublish: true },
};

const PAGE =
  '<h1>Q3 report</h1><p>Revenue grew 12% in Q3.</p><figure data-rm-anchor="revenue-chart"><canvas></canvas><figcaption>Revenue by month</figcaption></figure>';

type ReviewerViewer = Extract<comments.CommentViewer, { kind: 'reviewer' }>;

describe('threadVisibleTo — the visibility rule (D55)', () => {
  const base = {
    documentId: 'doc_1',
    threadId: null,
    anchor: null,
    anchorRevision: 1,
    anchorStatus: 'anchored' as const,
    body: 'x',
    intent: null,
    status: 'open' as const,
    resolvedBy: null,
    resolvedRevision: null,
    resolvedAt: null,
    createdAt: NOW,
  };
  const principalRoot = (visibility: 'internal' | 'shared'): CommentRecord => ({
    ...base,
    id: `cmt_p_${visibility}`,
    author: { kind: 'principal', principalId: 'prn_owner', name: 'Owner' },
    visibility,
  });
  const reviewerRoot = (reviewerId: string, linkMode: 'group' | 'individual' | null): CommentRecord => ({
    ...base,
    id: `cmt_${reviewerId}`,
    author: { kind: 'reviewer', reviewerId, name: reviewerId, grantId: 'grn_x', linkMode },
    visibility: null,
  });
  const reviewer = (id: string, mode: 'group' | 'individual'): ReviewerViewer => ({
    kind: 'reviewer',
    principal: { id: 'anonymous', kind: 'user', surface: 'rest', linkId: 'h' },
    reviewer: { id, grantId: 'g', documentId: 'doc_1', name: id, email: null, kind: 'invited', doneAt: null, createdAt: NOW },
    mode,
  });
  const owner: comments.CommentViewer = {
    kind: 'principal',
    principal: { id: 'prn_owner', kind: 'user', surface: 'admin' },
  };

  it('principals see every thread', () => {
    for (const root of [principalRoot('internal'), principalRoot('shared'), reviewerRoot('rvw_a', 'individual')]) {
      expect(comments.threadVisibleTo(root, owner)).toBe(true);
    }
  });

  it('reviewers never see internal notes; they see shared ones in either mode', () => {
    for (const mode of ['group', 'individual'] as const) {
      expect(comments.threadVisibleTo(principalRoot('internal'), reviewer('rvw_a', mode))).toBe(false);
      expect(comments.threadVisibleTo(principalRoot('shared'), reviewer('rvw_a', mode))).toBe(true);
    }
  });

  it('a reviewer always sees their own threads', () => {
    expect(comments.threadVisibleTo(reviewerRoot('rvw_a', 'individual'), reviewer('rvw_a', 'individual'))).toBe(true);
  });

  it("another reviewer's thread is visible only when BOTH links are in group mode", () => {
    const cases: ['group' | 'individual' | null, 'group' | 'individual', boolean][] = [
      ['group', 'group', true],
      ['group', 'individual', false],
      ['individual', 'group', false],
      ['individual', 'individual', false],
      [null, 'group', false], // the author's link was revoked → owner-only
    ];
    for (const [authorMode, viewerMode, expected] of cases) {
      expect(comments.threadVisibleTo(reviewerRoot('rvw_b', authorMode), reviewer('rvw_a', viewerMode))).toBe(expected);
    }
  });
});

describe('comments service (D55)', () => {
  let db: Database;
  let admin: Principal;
  let author: Principal;
  let other: Principal;
  let docId: string;

  const asPrincipal = (principal: Principal): comments.CommentViewer => ({ kind: 'principal', principal });

  async function reviewLink(mode: 'group' | 'individual', name?: string) {
    const link = await comments.createReviewLink(
      db,
      admin,
      { collection: 'reports', documentId: docId, mode, ...(name ? { reviewer: { name } } : {}) },
      SECRET,
      NOW,
    );
    const opened = await openShareLink(db, link.token, undefined, SECRET, NOW);
    return { ...link, grant: opened!.grant };
  }

  async function personalReviewer(mode: 'group' | 'individual', name: string): Promise<ReviewerViewer> {
    const { grant } = await reviewLink(mode, name);
    const r = await comments.reviewerForLink(db, grant, undefined);
    if (r.state !== 'ready') throw new Error(`expected ready, got ${r.state}`);
    return r.viewer;
  }

  async function titles(viewer: comments.CommentViewer) {
    const threads = await comments.listThreads(db, viewer, 'reports', docId, {}, NOW);
    return threads.map((t) => t.root.body).sort();
  }

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    other = await makePrincipal(db, NOW, { id: 'prn_other', role: 'author' });
    await collectionsService.createCollection(db, admin, DOCS, NOW);
    docId = (await docs.createDocument(db, admin, 'reports', { title: 'Q3', page: PAGE }, NOW)).id;
  });

  describe('principal comments', () => {
    it('anchors a quote, defaults to internal, records the revision and emits an event', async () => {
      const { root } = await comments.createThread(
        db,
        asPrincipal(admin),
        'reports',
        docId,
        { anchor: { kind: 'text', quote: 'grew 12%' }, body: 'Source?', intent: 'question' },
        NOW,
      );
      expect(root).toMatchObject({
        visibility: 'internal',
        status: 'open',
        intent: 'question',
        anchorRevision: 1,
        anchorStatus: 'anchored',
        author: { kind: 'principal', principalId: 'prn_admin' },
      });
      expect(root.anchor).toMatchObject({ kind: 'text', field: 'page', quote: 'grew 12%' });
    });

    it('a quote the server cannot find falls back to its block, then to the document', async () => {
      const onChart = await comments.createThread(
        db,
        asPrincipal(admin),
        'reports',
        docId,
        { anchor: { kind: 'text', quote: '$4.2m', blockId: 'revenue-chart' }, body: 'Live value looks off' },
        NOW,
      );
      expect(onChart.root.anchor).toEqual({ kind: 'block', field: 'page', blockId: 'revenue-chart' });
      const general = await comments.createThread(db, asPrincipal(admin), 'reports', docId, { body: 'Overall: good' }, NOW);
      expect(general.root.anchor).toEqual({ kind: 'document' });
    });

    it('validates body, intent and visibility', async () => {
      const make = (input: comments.NewCommentInput) =>
        comments.createThread(db, asPrincipal(admin), 'reports', docId, input, NOW);
      await expect(make({ body: '   ' })).rejects.toBeInstanceOf(InputValidationError);
      await expect(make({ body: 'x'.repeat(comments.MAX_COMMENT_CHARS + 1) })).rejects.toBeInstanceOf(
        InputValidationError,
      );
      await expect(make({ body: 'x', intent: 'rant' })).rejects.toBeInstanceOf(InputValidationError);
      await expect(make({ body: 'x', visibility: 'public' })).rejects.toBeInstanceOf(InputValidationError);
    });

    it('authors may comment on their own documents only (comment:own)', async () => {
      const own = (await docs.createDocument(db, author, 'reports', { title: 'Mine', page: PAGE }, NOW)).id;
      await expect(
        comments.createThread(db, asPrincipal(author), 'reports', own, { body: 'note to self' }, NOW),
      ).resolves.toBeTruthy();
      await expect(
        comments.createThread(db, asPrincipal(other), 'reports', own, { body: 'drive-by' }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('threads: replies attach to the root; resolve stamps the current revision; reopen clears it', async () => {
      const { root } = await comments.createThread(db, asPrincipal(admin), 'reports', docId, { body: 'Tighten intro' }, NOW);
      await comments.replyToThread(db, asPrincipal(admin), 'reports', docId, root.id, { body: 'Agreed' }, NOW);
      await docs.updateDocument(db, admin, 'reports', docId, { title: 'Q3 (v2)' }, NOW);

      const resolved = await comments.setThreadResolved(db, admin, 'reports', docId, root.id, true, NOW);
      expect(resolved).toMatchObject({ status: 'resolved', resolvedRevision: 2, resolvedBy: 'prn_admin' });
      const reopened = await comments.setThreadResolved(db, admin, 'reports', docId, root.id, false, NOW);
      expect(reopened).toMatchObject({ status: 'open', resolvedRevision: null });

      const [thread] = await comments.listThreads(db, asPrincipal(admin), 'reports', docId, {}, NOW);
      expect(thread.replies.map((r) => r.body)).toEqual(['Agreed']);
    });

    it('whoever may update the document may read and resolve its threads, but not post', async () => {
      const { root } = await comments.createThread(db, asPrincipal(admin), 'reports', docId, { body: 'Fix the chart' }, NOW);
      // `other` is an author on someone else's document: no comment, no update — refused.
      await expect(comments.listThreads(db, asPrincipal(other), 'reports', docId, {}, NOW)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await grantItem(
        db,
        admin,
        { subjectKind: 'principal', subjectId: other.id, documentId: docId, collection: 'reports', actions: ['read', 'update'] },
        NOW,
      );

      const threads = await comments.listThreads(db, asPrincipal(other), 'reports', docId, {}, NOW);
      expect(threads.map((t) => t.root.body)).toEqual(['Fix the chart']);
      expect(threads[0].root.author).toMatchObject({ kind: 'principal', principalId: 'prn_admin' });
      await expect(comments.renderReview(db, other, 'reports', docId, {}, NOW)).resolves.toContain('Fix the chart');
      await comments.resolveThreads(db, other, 'reports', docId, [root.id], NOW);
      const [resolved] = await comments.listThreads(db, asPrincipal(other), 'reports', docId, {}, NOW);
      expect(resolved.root).toMatchObject({ status: 'resolved', resolvedBy: other.id });

      await expect(
        comments.createThread(db, asPrincipal(other), 'reports', docId, { body: 'drive-by' }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        comments.replyToThread(db, asPrincipal(other), 'reports', docId, root.id, { body: 'drive-by' }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('a refused thread read names both routes in and is audited once', async () => {
      const err = await comments.listThreads(db, asPrincipal(other), 'reports', docId, {}, NOW).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).message).toMatch(/requires 'comment' or 'update'.*whoami/);
      expect((err as ForbiddenError).missing).toEqual({ action: 'comment', collection: 'reports' });
      const denials = (await recentAudit(db, 50)).filter((r) => r.principalId === other.id && !r.allowed);
      expect(denials.map((r) => r.action)).toEqual(['comment']);
    });

    it('resolveThreads validates every id before resolving any', async () => {
      const a = await comments.createThread(db, asPrincipal(admin), 'reports', docId, { body: 'a' }, NOW);
      await expect(
        comments.resolveThreads(db, admin, 'reports', docId, [a.root.id, 'cmt_nope'], NOW),
      ).rejects.toBeInstanceOf(NotFoundError);
      const open = await comments.listThreads(db, asPrincipal(admin), 'reports', docId, { status: 'open' }, NOW);
      expect(open).toHaveLength(1);
    });
  });

  describe('re-anchoring on save (both edit paths share updateDocument)', () => {
    it('moves text anchors, keeps block anchors, and marks removed quotes outdated', async () => {
      const text = await comments.createThread(
        db,
        asPrincipal(admin),
        'reports',
        docId,
        { anchor: { kind: 'text', quote: 'grew 12%' }, body: 'Source?' },
        NOW,
      );
      const block = await comments.createThread(
        db,
        asPrincipal(admin),
        'reports',
        docId,
        { anchor: { kind: 'block', blockId: 'revenue-chart' }, body: 'Label the axes' },
        NOW,
      );

      await docs.updateDocument(db, admin, 'reports', docId, { page: `<p>Summary first.</p>${PAGE}` }, NOW);
      let threads = await comments.listThreads(db, asPrincipal(admin), 'reports', docId, {}, NOW);
      const moved = threads.find((t) => t.root.id === text.root.id)!.root;
      expect(moved.anchorStatus).toBe('anchored');
      expect(moved.anchorRevision).toBe(2);
      expect(moved.anchor).toMatchObject({ kind: 'text', prefix: expect.stringContaining('Summary first.') });

      await docs.updateDocument(db, admin, 'reports', docId, { page: '<p>Revenue grew 15% in Q3.</p>' }, NOW);
      threads = await comments.listThreads(db, asPrincipal(admin), 'reports', docId, {}, NOW);
      expect(threads.find((t) => t.root.id === text.root.id)!.root.anchorStatus).toBe('outdated');
      expect(threads.find((t) => t.root.id === block.root.id)!.root.anchorStatus).toBe('outdated');
    });

    it('leaves resolved threads alone', async () => {
      const t = await comments.createThread(
        db,
        asPrincipal(admin),
        'reports',
        docId,
        { anchor: { kind: 'text', quote: 'grew 12%' }, body: 'Source?' },
        NOW,
      );
      await comments.setThreadResolved(db, admin, 'reports', docId, t.root.id, true, NOW);
      await docs.updateDocument(db, admin, 'reports', docId, { page: '<p>All new.</p>' }, NOW);
      const [thread] = await comments.listThreads(db, asPrincipal(admin), 'reports', docId, {}, NOW);
      expect(thread.root).toMatchObject({ anchorStatus: 'anchored', anchorRevision: 1 });
    });
  });

  describe('review links', () => {
    it('a personal link knows its reviewer; an open link asks for a name once', async () => {
      const personal = await reviewLink('group', 'Alice');
      expect(personal.reviewer).toMatchObject({ name: 'Alice', kind: 'invited' });
      expect(await comments.reviewerForLink(db, personal.grant, undefined)).toMatchObject({
        state: 'ready',
        viewer: { reviewer: { name: 'Alice' } },
      });
      await expect(comments.identifyReviewer(db, personal.grant, 'Mallory', NOW)).rejects.toBeInstanceOf(
        BadRequestError,
      );

      const open = await reviewLink('group');
      expect(await comments.reviewerForLink(db, open.grant, undefined)).toEqual({ state: 'needs_name' });
      const bob = await comments.identifyReviewer(db, open.grant, '  Bob  ', NOW);
      expect(bob.reviewer).toMatchObject({ name: 'Bob', kind: 'self_named' });
      expect(await comments.reviewerForLink(db, open.grant, bob.reviewer.id)).toMatchObject({ state: 'ready' });
      // Another link's reviewer id is not an identity on this link.
      expect(await comments.reviewerForLink(db, open.grant, 'rvw_forged')).toEqual({ state: 'needs_name' });
    });

    it('a plain read link is not a review link and cannot comment', async () => {
      const link = await createShareLink(
        db,
        admin,
        { collection: 'reports', documentId: docId, actions: ['read'] },
        SECRET,
        NOW,
      );
      const opened = await openShareLink(db, link.token, undefined, SECRET, NOW);
      expect(await comments.reviewerForLink(db, opened!.grant, undefined)).toEqual({ state: 'not_review_link' });
      await expect(comments.identifyReviewer(db, opened!.grant, 'Eve', NOW)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('group vs individual visibility, end to end', async () => {
      const alice = await personalReviewer('group', 'Alice');
      const bob = await personalReviewer('group', 'Bob');
      const carol = await personalReviewer('individual', 'Carol');

      for (const [viewer, body] of [
        [alice, 'from alice'],
        [bob, 'from bob'],
        [carol, 'from carol'],
      ] as const) {
        await comments.createThread(db, viewer, 'reports', docId, { body }, NOW);
      }
      await comments.createThread(db, asPrincipal(admin), 'reports', docId, { body: 'owner internal' }, NOW);
      await comments.createThread(
        db,
        asPrincipal(admin),
        'reports',
        docId,
        { body: 'owner shared', visibility: 'shared' },
        NOW,
      );

      expect(await titles(alice)).toEqual(['from alice', 'from bob', 'owner shared']);
      expect(await titles(carol)).toEqual(['from carol', 'owner shared']);
      expect(await titles(asPrincipal(admin))).toHaveLength(5);
    });

    it('flipping a link to group re-scopes its PAST comments, with counts for the warning', async () => {
      const alice = await personalReviewer('group', 'Alice');
      const carolLink = await reviewLink('individual', 'Carol');
      const carolReady = await comments.reviewerForLink(db, carolLink.grant, undefined);
      if (carolReady.state !== 'ready') throw new Error('carol not ready');
      await comments.createThread(db, carolReady.viewer, 'reports', docId, { body: 'carol 1' }, NOW);
      await comments.createThread(db, carolReady.viewer, 'reports', docId, { body: 'carol 2' }, NOW);
      expect(await titles(alice)).toEqual([]);

      const preview = await comments.previewReviewModeFlip(db, admin, 'reports', docId, carolLink.grantId, NOW);
      expect(preview).toEqual({ from: 'individual', to: 'group', comments: 2, reviewers: 1 });

      await comments.setReviewMode(db, admin, 'reports', docId, carolLink.grantId, 'group', NOW);
      expect(await titles(alice)).toEqual(['carol 1', 'carol 2']);
    });

    it('reviewers may reply to threads they can see, but never resolve', async () => {
      const alice = await personalReviewer('individual', 'Alice');
      const shared = await comments.createThread(
        db,
        asPrincipal(admin),
        'reports',
        docId,
        { body: 'What do you think?', visibility: 'shared' },
        NOW,
      );
      const internal = await comments.createThread(db, asPrincipal(admin), 'reports', docId, { body: 'secret' }, NOW);

      await expect(
        comments.replyToThread(db, alice, 'reports', docId, shared.root.id, { body: 'Looks good' }, NOW),
      ).resolves.toMatchObject({ threadId: shared.root.id, author: { kind: 'reviewer', name: 'Alice' } });
      // An invisible thread is indistinguishable from a missing one.
      await expect(
        comments.replyToThread(db, alice, 'reports', docId, internal.root.id, { body: 'peek' }, NOW),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        comments.setThreadResolved(db, alice.principal, 'reports', docId, shared.root.id, true, NOW),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("a reviewer can't reach another document with their link", async () => {
      const alice = await personalReviewer('group', 'Alice');
      const otherDoc = (await docs.createDocument(db, admin, 'reports', { title: 'Other', page: PAGE }, NOW)).id;
      await expect(
        comments.createThread(db, alice, 'reports', otherDoc, { body: 'x' }, NOW),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('revoking a link cuts the reviewer off; their comments stay, owner-only', async () => {
      const bob = await personalReviewer('group', 'Bob');
      const alice = await personalReviewer('group', 'Alice');
      await comments.createThread(db, alice, 'reports', docId, { body: 'from alice' }, NOW);
      expect(await titles(bob)).toEqual(['from alice']);

      await revokeShareLink(db, admin, 'reports', docId, alice.reviewer.grantId, NOW);
      await expect(
        comments.createThread(db, alice, 'reports', docId, { body: 'again' }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await titles(bob)).toEqual([]);
      const [kept] = await comments.listThreads(db, asPrincipal(admin), 'reports', docId, {}, NOW);
      expect(kept.root.author).toMatchObject({ kind: 'reviewer', name: 'Alice', reviewerId: null });
    });

    it('delete: own comments only, except principals who can update the document', async () => {
      const alice = await personalReviewer('group', 'Alice');
      const bob = await personalReviewer('group', 'Bob');
      const { root } = await comments.createThread(db, alice, 'reports', docId, { body: 'spam?' }, NOW);
      await expect(comments.deleteComment(db, bob, 'reports', docId, root.id, NOW)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await comments.deleteComment(db, asPrincipal(admin), 'reports', docId, root.id, NOW);
      expect(await titles(asPrincipal(admin))).toEqual([]);
    });

    it('done marks a reviewer complete, and listReviewLinks reports it', async () => {
      const alice = await personalReviewer('group', 'Alice');
      await comments.setReviewerDone(db, alice, 'reports', true, NOW);
      const links = await comments.listReviewLinks(db, admin, 'reports', docId, SECRET, 'https://x.test', NOW);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ reviewMode: 'group', personal: true });
      expect(links[0].reviewers[0]).toMatchObject({ name: 'Alice', doneAt: NOW });
      expect(links[0].url).toMatch(/^https:\/\/x\.test\/s\//);
    });
  });
});
