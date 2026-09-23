/**
 * Comment + reviewer queries (D55). Every function touching comment content
 * takes a `Grant` witness, like the document queries: a service can't read or
 * write review threads without having passed `authorize()`. Visibility is NOT
 * decided here — rows come back with the facts it depends on (author kind, the
 * principal root's visibility, the reviewer's link and its CURRENT review mode)
 * and the comments service applies the rule.
 */

import { and, asc, count, countDistinct, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '@/db/client';
import { comments, itemGrants, reviewReviewers } from '@/db/schema';
import { eventInsert, type EventInput } from '@/db/queries/events';
import type { ReviewMode } from '@/db/queries/grants';
import { newId } from '@/lib/id';
import type { Grant } from '@/access/grant';
import { parseStoredAnchor, type Anchor, type AnchorStatus } from '@/lib/anchor/anchor';

type Batch = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

export const COMMENT_INTENTS = ['must_fix', 'question', 'suggestion', 'nit', 'praise'] as const;
export type CommentIntent = (typeof COMMENT_INTENTS)[number];
export type CommentVisibility = 'internal' | 'shared';
export type ThreadStatus = 'open' | 'resolved';

export type CommentAuthor =
  | { readonly kind: 'principal'; readonly principalId: string; readonly name: string }
  | {
      readonly kind: 'reviewer';
      /** Null once the reviewer's link was revoked (the name survives). */
      readonly reviewerId: string | null;
      readonly name: string;
      /** The reviewer's link and its mode NOW — null once revoked. */
      readonly grantId: string | null;
      readonly linkMode: ReviewMode | null;
    };

export interface CommentRecord {
  readonly id: string;
  readonly documentId: string;
  /** Null on a thread root; the root's id on a reply. */
  readonly threadId: string | null;
  readonly author: CommentAuthor;
  /** Principal roots only. */
  readonly visibility: CommentVisibility | null;
  /** Roots only. */
  readonly anchor: Anchor | null;
  readonly anchorRevision: number | null;
  readonly anchorStatus: AnchorStatus | null;
  readonly body: string;
  readonly intent: CommentIntent | null;
  /** Roots only. */
  readonly status: ThreadStatus | null;
  readonly resolvedBy: string | null;
  readonly resolvedRevision: number | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface ReviewerRecord {
  readonly id: string;
  readonly grantId: string;
  readonly documentId: string;
  readonly name: string;
  readonly email: string | null;
  readonly kind: 'invited' | 'self_named';
  readonly doneAt: string | null;
  readonly createdAt: string;
}

const selectComment = {
  c: comments,
  reviewerGrantId: reviewReviewers.grantId,
  linkMode: itemGrants.reviewMode,
};

type CommentRow = {
  c: typeof comments.$inferSelect;
  reviewerGrantId: string | null;
  linkMode: string | null;
};

function toDomain({ c, reviewerGrantId, linkMode }: CommentRow): CommentRecord {
  const author: CommentAuthor =
    c.authorKind === 'principal'
      ? { kind: 'principal', principalId: c.authorPrincipalId ?? '', name: c.authorName }
      : {
          kind: 'reviewer',
          reviewerId: c.reviewerId,
          name: c.authorName,
          grantId: reviewerGrantId,
          linkMode: (linkMode as ReviewMode | null) ?? null,
        };
  return {
    id: c.id,
    documentId: c.documentId,
    threadId: c.threadId,
    author,
    visibility: (c.visibility as CommentVisibility | null) ?? null,
    anchor: parseStoredAnchor(c.anchorJson),
    anchorRevision: c.anchorRevision,
    anchorStatus: (c.anchorStatus as AnchorStatus | null) ?? null,
    body: c.body,
    intent: (c.intent as CommentIntent | null) ?? null,
    status: (c.status as ThreadStatus | null) ?? null,
    resolvedBy: c.resolvedBy,
    resolvedRevision: c.resolvedRevision,
    resolvedAt: c.resolvedAt,
    createdAt: c.createdAt,
  };
}

function reviewerToDomain(r: typeof reviewReviewers.$inferSelect): ReviewerRecord {
  return { ...r, kind: r.kind as ReviewerRecord['kind'] };
}

function baseSelect(db: Database) {
  return db
    .select(selectComment)
    .from(comments)
    .leftJoin(reviewReviewers, eq(reviewReviewers.id, comments.reviewerId))
    .leftJoin(itemGrants, eq(itemGrants.id, reviewReviewers.grantId));
}

/** Every comment on a document (roots and replies), oldest first. */
export async function listCommentsForDocument(
  db: Database,
  documentId: string,
  _grant: Grant,
): Promise<CommentRecord[]> {
  const rows = await baseSelect(db)
    .where(eq(comments.documentId, documentId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return rows.map(toDomain);
}

export async function getComment(db: Database, id: string, _grant: Grant): Promise<CommentRecord | null> {
  const rows = await baseSelect(db).where(eq(comments.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export interface NewComment {
  readonly documentId: string;
  readonly threadId: string | null;
  readonly author:
    | { readonly kind: 'principal'; readonly principalId: string; readonly name: string }
    | { readonly kind: 'reviewer'; readonly reviewerId: string; readonly name: string };
  readonly visibility: CommentVisibility | null;
  readonly anchor: Anchor | null;
  readonly anchorRevision: number | null;
  readonly body: string;
  readonly intent: CommentIntent | null;
  readonly now: string;
  readonly event: EventInput;
}

/** Insert one comment and its outbox event atomically. Returns the new id. */
export async function insertComment(db: Database, input: NewComment, _grant: Grant): Promise<string> {
  const id = newId('comment');
  const isRoot = input.threadId === null;
  await db.batch([
    db.insert(comments).values({
      id,
      documentId: input.documentId,
      threadId: input.threadId,
      authorKind: input.author.kind,
      authorPrincipalId: input.author.kind === 'principal' ? input.author.principalId : null,
      reviewerId: input.author.kind === 'reviewer' ? input.author.reviewerId : null,
      authorName: input.author.name,
      visibility: input.visibility,
      anchorJson: input.anchor ? JSON.stringify(input.anchor) : null,
      anchorRevision: input.anchorRevision,
      anchorStatus: isRoot && input.anchor ? 'anchored' : null,
      body: input.body,
      intent: input.intent,
      status: isRoot ? 'open' : null,
      createdAt: input.now,
    }),
    eventInsert(db, input.event),
  ] as Batch);
  return id;
}

/** Resolve or reopen a thread (root row), with its outbox event. */
export async function setThreadStatus(
  db: Database,
  rootId: string,
  change:
    | { readonly status: 'resolved'; readonly by: string; readonly revision: number; readonly at: string }
    | { readonly status: 'open' },
  event: EventInput,
  _grant: Grant,
): Promise<void> {
  const values =
    change.status === 'resolved'
      ? { status: 'resolved', resolvedBy: change.by, resolvedRevision: change.revision, resolvedAt: change.at }
      : { status: 'open', resolvedBy: null, resolvedRevision: null, resolvedAt: null };
  await db.batch([
    db
      .update(comments)
      .set(values)
      .where(and(eq(comments.id, rootId), isNull(comments.threadId))),
    eventInsert(db, event),
  ] as Batch);
}

/** Delete a comment; deleting a root cascades its replies (FK). */
export async function deleteComment(db: Database, id: string, _grant: Grant): Promise<void> {
  await db.delete(comments).where(eq(comments.id, id));
}

export interface AnchorUpdate {
  readonly id: string;
  readonly anchor: Anchor;
  readonly status: AnchorStatus;
  readonly revision: number;
}

/** Write re-anchoring results (after a document save) in one batch. */
export async function updateAnchors(db: Database, updates: readonly AnchorUpdate[], _grant: Grant): Promise<void> {
  if (!updates.length) return;
  await db.batch(
    updates.map((u) =>
      db
        .update(comments)
        .set({ anchorJson: JSON.stringify(u.anchor), anchorStatus: u.status, anchorRevision: u.revision })
        .where(eq(comments.id, u.id)),
    ) as unknown as Batch,
  );
}

/** Open, anchored-to-something thread roots of a document — the rows a save
 *  re-anchors. */
export async function listOpenAnchoredRoots(
  db: Database,
  documentId: string,
  _grant: Grant,
): Promise<CommentRecord[]> {
  const rows = await baseSelect(db).where(
    and(
      eq(comments.documentId, documentId),
      isNull(comments.threadId),
      eq(comments.status, 'open'),
      sql`${comments.anchorJson} IS NOT NULL`,
    ),
  );
  return rows.map(toDomain);
}

// ---------------------------------------------------------------------------
// Reviewers
// ---------------------------------------------------------------------------

export async function insertReviewer(
  db: Database,
  input: {
    readonly grantId: string;
    readonly documentId: string;
    readonly name: string;
    readonly email: string | null;
    readonly kind: ReviewerRecord['kind'];
  },
  now: string,
): Promise<ReviewerRecord> {
  const row = { id: newId('reviewer'), ...input, doneAt: null, createdAt: now };
  await db.insert(reviewReviewers).values(row);
  return row;
}

export async function getReviewer(db: Database, id: string): Promise<ReviewerRecord | null> {
  const rows = await db.select().from(reviewReviewers).where(eq(reviewReviewers.id, id)).limit(1);
  return rows[0] ? reviewerToDomain(rows[0]) : null;
}

export async function listReviewersForGrant(db: Database, grantId: string): Promise<ReviewerRecord[]> {
  const rows = await db
    .select()
    .from(reviewReviewers)
    .where(eq(reviewReviewers.grantId, grantId))
    .orderBy(asc(reviewReviewers.createdAt));
  return rows.map(reviewerToDomain);
}

export async function listReviewersForDocument(db: Database, documentId: string): Promise<ReviewerRecord[]> {
  const rows = await db
    .select()
    .from(reviewReviewers)
    .where(eq(reviewReviewers.documentId, documentId))
    .orderBy(asc(reviewReviewers.createdAt));
  return rows.map(reviewerToDomain);
}

export async function setReviewerDone(db: Database, reviewerId: string, doneAt: string | null): Promise<void> {
  await db.update(reviewReviewers).set({ doneAt }).where(eq(reviewReviewers.id, reviewerId));
}

/** How many thread roots — and from how many distinct reviewers — were made
 *  through a link's reviewers: what a review-mode flip re-scopes. */
export async function countRootsByGrant(
  db: Database,
  grantId: string,
): Promise<{ comments: number; reviewers: number }> {
  const ids = (await listReviewersForGrant(db, grantId)).map((r) => r.id);
  if (!ids.length) return { comments: 0, reviewers: 0 };
  const rows = await db
    .select({ comments: count(), reviewers: countDistinct(comments.reviewerId) })
    .from(comments)
    .where(and(inArray(comments.reviewerId, ids), isNull(comments.threadId)));
  return { comments: rows[0]?.comments ?? 0, reviewers: rows[0]?.reviewers ?? 0 };
}
