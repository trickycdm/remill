/**
 * Document review (D55) — anchored comment threads, review links, and the
 * visibility rule that decides who sees which thread.
 *
 * Two kinds of commenter, one pipeline:
 *   - PRINCIPALS (people with accounts, agents) — `authorize(principal,
 *     'comment', …)` through their roles or item grants. Their thread roots are
 *     `internal` (principals only) or `shared` (reviewers see them too).
 *   - REVIEWERS — a name attached to one review link (a share link whose
 *     actions include `comment`). They authorize as the anonymous principal
 *     carrying the link's identity, through the SAME item-grant path share links
 *     already use; `decide()` knows nothing new.
 *
 * Visibility (see `threadVisibleTo`): principals see every thread. A reviewer
 * sees their own threads, `shared` principal threads, and — only while their
 * own link is in `group` mode — threads from other `group`-mode links. The link
 * mode is read LIVE, so flipping a link re-scopes its past comments at once.
 * Replies always follow their root.
 *
 * Comments bodies are plain text: every surface renders them escaped.
 */

import type { Database } from '@/db/client';
import { authorize, canAuthorize, anonymousPrincipal, type Grant, type Principal } from '@/access';
import * as cq from '@/db/queries/comments';
import * as grantQ from '@/db/queries/grants';
import * as dq from '@/db/queries/documents';
import { getCollection } from '@/db/queries/collections';
import { getPrincipal } from '@/db/queries/principals';
import { createShareLink, listShareLinks, type ShareLinkListItem } from '@/services/access';
import { canonicalDocument } from '@/lib/anchor/canonical';
import { titleOf } from '@/lib/def-helpers';
import { buildReviewBrief } from './review-brief';
import { resolveAnchor, relocateAnchor, type AnchorInput } from '@/lib/anchor/anchor';
import { InputValidationError, NotFoundError, BadRequestError, ForbiddenError } from '@/lib/errors';
import type { CollectionDefinition } from '@/fields/types';

export type {
  CommentRecord,
  CommentIntent,
  CommentVisibility,
  CommentAuthor,
  ReviewerRecord,
  ThreadStatus,
} from '@/db/queries/comments';
export { COMMENT_INTENTS } from '@/db/queries/comments';
export type { ReviewMode } from '@/db/queries/grants';
export { REVIEW_MODES } from '@/db/queries/grants';
export type { AnchorInput } from '@/lib/anchor/anchor';
export { hasAnnotatableFields } from '@/lib/anchor/canonical';

export const MAX_COMMENT_CHARS = 4000;
export const MAX_REVIEWER_NAME_CHARS = 60;

/** Who is reading or writing comments. A reviewer carries the anonymous
 *  principal with its link identity (`linkId`), plus the reviewer row and the
 *  link's current mode. */
export type CommentViewer =
  | { readonly kind: 'principal'; readonly principal: Principal }
  | {
      readonly kind: 'reviewer';
      readonly principal: Principal;
      readonly reviewer: cq.ReviewerRecord;
      readonly mode: grantQ.ReviewMode;
    };

export interface CommentThread {
  readonly root: cq.CommentRecord;
  readonly replies: readonly cq.CommentRecord[];
}

// ---------------------------------------------------------------------------
// The visibility rule — pure, so it's tested exhaustively on its own.
// ---------------------------------------------------------------------------

export function threadVisibleTo(root: cq.CommentRecord, viewer: CommentViewer): boolean {
  if (viewer.kind === 'principal') return true;
  const author = root.author;
  if (author.kind === 'principal') return root.visibility === 'shared';
  if (author.reviewerId === viewer.reviewer.id) return true;
  return viewer.mode === 'group' && author.linkMode === 'group';
}

// ---------------------------------------------------------------------------
// Reviewer identity on a review link
// ---------------------------------------------------------------------------

/** Whether a share-link grant is a review link (D55). */
export function isReviewLink(grant: grantQ.ItemGrantRecord): boolean {
  return grant.reviewMode !== null && grant.actions.includes('comment');
}

/**
 * Resolve who is reviewing through an OPEN share-link grant (the route has
 * already passed the password gate via `openShareLink`). A personal link has
 * exactly one invited reviewer — having the link is the identity. An open link
 * identifies a self-named reviewer by the id in its `rm_reviewer` cookie; with
 * no (valid) cookie the reviewer still has to give a name.
 */
export async function reviewerForLink(
  db: Database,
  grant: grantQ.ItemGrantRecord,
  cookieReviewerId: string | undefined,
): Promise<
  | { readonly state: 'not_review_link' }
  | { readonly state: 'needs_name' }
  | { readonly state: 'ready'; readonly viewer: Extract<CommentViewer, { kind: 'reviewer' }> }
> {
  if (!isReviewLink(grant)) return { state: 'not_review_link' };
  const reviewers = await cq.listReviewersForGrant(db, grant.id);
  const invited = reviewers.find((r) => r.kind === 'invited');
  const reviewer =
    invited ?? (cookieReviewerId ? reviewers.find((r) => r.id === cookieReviewerId && r.kind === 'self_named') : undefined);
  if (!reviewer) return { state: 'needs_name' };
  return { state: 'ready', viewer: reviewerViewer(grant, reviewer) };
}

function reviewerViewer(
  grant: grantQ.ItemGrantRecord,
  reviewer: cq.ReviewerRecord,
): Extract<CommentViewer, { kind: 'reviewer' }> {
  return {
    kind: 'reviewer',
    principal: { ...anonymousPrincipal('rest'), linkId: grant.subjectId },
    reviewer,
    mode: grant.reviewMode ?? 'individual',
  };
}

/** The collection a review link's document lives in — metadata only (the
 *  link grant already names the document; content still flows only through
 *  `authorize()`d calls). */
export async function reviewLinkCollection(db: Database, grant: grantQ.ItemGrantRecord): Promise<string> {
  const collection = await dq.getDocumentCollection(db, grant.documentId);
  if (!collection) throw new NotFoundError('Document');
  return collection;
}

/** A reviewer on an OPEN review link names themselves (once — the route keeps
 *  the returned id in a signed, link-scoped cookie). Personal links already
 *  know their reviewer and refuse. */
export async function identifyReviewer(
  db: Database,
  grant: grantQ.ItemGrantRecord,
  name: string,
  now: string,
): Promise<Extract<CommentViewer, { kind: 'reviewer' }>> {
  if (!isReviewLink(grant)) throw new NotFoundError('Review link');
  const reviewers = await cq.listReviewersForGrant(db, grant.id);
  if (reviewers.some((r) => r.kind === 'invited')) {
    throw new BadRequestError('This review link belongs to a named reviewer.');
  }
  const reviewer = await cq.insertReviewer(
    db,
    { grantId: grant.id, documentId: grant.documentId, name: cleanName(name), email: null, kind: 'self_named' },
    now,
  );
  return reviewerViewer(grant, reviewer);
}

function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_REVIEWER_NAME_CHARS) {
    throw new InputValidationError([
      { path: 'name', message: `Enter a name of 1–${MAX_REVIEWER_NAME_CHARS} characters.` },
    ]);
  }
  return name;
}

/** A reviewer marks their review complete (or takes it back). */
export async function setReviewerDone(
  db: Database,
  viewer: Extract<CommentViewer, { kind: 'reviewer' }>,
  collection: string,
  done: boolean,
  now: string,
): Promise<void> {
  await authorize(db, viewer.principal, 'comment', { collection, documentId: viewer.reviewer.documentId }, now);
  await cq.setReviewerDone(db, viewer.reviewer.id, done ? now : null);
}

// ---------------------------------------------------------------------------
// Reading threads
// ---------------------------------------------------------------------------

export interface ThreadFilters {
  readonly status?: cq.ThreadStatus;
  readonly intent?: cq.CommentIntent;
  /** Only threads started by this reviewer. */
  readonly reviewerId?: string;
}

async function authorizeComment(
  db: Database,
  viewer: CommentViewer,
  collection: string,
  documentId: string,
  now: string,
): Promise<Grant> {
  if (viewer.kind === 'reviewer' && viewer.reviewer.documentId !== documentId) {
    throw new NotFoundError('Document');
  }
  return authorize(db, viewer.principal, 'comment', { collection, documentId }, now);
}

function assembleThreads(rows: readonly cq.CommentRecord[]): CommentThread[] {
  const replies = new Map<string, cq.CommentRecord[]>();
  for (const r of rows) {
    if (r.threadId) replies.set(r.threadId, [...(replies.get(r.threadId) ?? []), r]);
  }
  return rows.filter((r) => r.threadId === null).map((root) => ({ root, replies: replies.get(root.id) ?? [] }));
}

/** The threads on a document this viewer may see, oldest first. */
export async function listThreads(
  db: Database,
  viewer: CommentViewer,
  collection: string,
  documentId: string,
  filters: ThreadFilters,
  now: string,
): Promise<CommentThread[]> {
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  const rows = await cq.listCommentsForDocument(db, documentId, grant);
  return assembleThreads(rows).filter(
    ({ root }) =>
      threadVisibleTo(root, viewer) &&
      (!filters.status || root.status === filters.status) &&
      (!filters.intent || root.intent === filters.intent) &&
      (!filters.reviewerId || (root.author.kind === 'reviewer' && root.author.reviewerId === filters.reviewerId)),
  );
}

/** Everything the review panel renders for one viewer: the visible threads,
 *  the document's commentable blocks (for the keyboard-reachable "comment on a
 *  figure" choice), and whether the viewer may moderate (delete any comment). */
export interface ReviewPanelData {
  readonly threads: readonly CommentThread[];
  readonly blocks: readonly { readonly id: string; readonly field: string }[];
  readonly canModerate: boolean;
}

export async function reviewPanelData(
  db: Database,
  viewer: CommentViewer,
  collection: string,
  documentId: string,
  now: string,
): Promise<ReviewPanelData> {
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  const def = await loadDef(db, collection);
  const doc = await dq.getDocument(db, collection, documentId, grant);
  if (!doc) throw new NotFoundError('Document');
  const threads = assembleThreads(await cq.listCommentsForDocument(db, documentId, grant)).filter(({ root }) =>
    threadVisibleTo(root, viewer),
  );
  const blocks = [...canonicalDocument(def, doc.data)].flatMap(([field, c]) =>
    c.blocks.map((b) => ({ id: b.id, field })),
  );
  const canModerate =
    viewer.kind === 'principal' &&
    (await canAuthorize(db, viewer.principal, 'update', { collection, documentId }, now));
  return { threads, blocks, canModerate };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NewCommentInput {
  /** Omit for a general comment on the whole document. */
  readonly anchor?: AnchorInput;
  readonly body: string;
  readonly intent?: string;
  /** Principals only; defaults to 'internal'. Ignored for reviewers, whose
   *  visibility comes from their link's mode. */
  readonly visibility?: string;
}

/** Parse an untrusted anchor proposal (a JSON body, form signals) into an
 *  `AnchorInput`, dropping unknown keys and wrong-typed values. Absent →
 *  undefined (a general comment). */
export function parseAnchorInput(raw: unknown): AnchorInput | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InputValidationError([{ path: 'anchor', message: 'anchor must be an object.' }]);
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== 'text' && o.kind !== 'block' && o.kind !== 'document') {
    throw new InputValidationError([{ path: 'anchor.kind', message: "kind must be 'text', 'block' or 'document'." }]);
  }
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const start = typeof o.start === 'number' && Number.isInteger(o.start) && o.start >= 0 ? o.start : undefined;
  return {
    kind: o.kind,
    field: str(o.field),
    quote: str(o.quote),
    prefix: str(o.prefix),
    suffix: str(o.suffix),
    start,
    blockId: str(o.blockId),
  };
}

function cleanBody(raw: string): string {
  const body = raw.trim();
  if (!body || body.length > MAX_COMMENT_CHARS) {
    throw new InputValidationError([
      { path: 'body', message: `A comment must be 1–${MAX_COMMENT_CHARS} characters.` },
    ]);
  }
  return body;
}

function cleanIntent(raw: string | undefined): cq.CommentIntent | null {
  if (raw === undefined || raw === '') return null;
  if (!(cq.COMMENT_INTENTS as readonly string[]).includes(raw)) {
    throw new InputValidationError([
      { path: 'intent', message: `Intent must be one of ${cq.COMMENT_INTENTS.join(', ')}.` },
    ]);
  }
  return raw as cq.CommentIntent;
}

function cleanVisibility(raw: string | undefined): cq.CommentVisibility {
  if (raw === undefined || raw === '') return 'internal';
  if (raw !== 'internal' && raw !== 'shared') {
    throw new InputValidationError([{ path: 'visibility', message: "Visibility must be 'internal' or 'shared'." }]);
  }
  return raw;
}

async function loadDef(db: Database, collection: string): Promise<CollectionDefinition> {
  const def = await getCollection(db, collection);
  if (!def) throw new NotFoundError(`Collection '${collection}'`);
  return def;
}

async function authorFor(viewer: CommentViewer, db: Database): Promise<cq.NewComment['author']> {
  if (viewer.kind === 'reviewer') {
    return { kind: 'reviewer', reviewerId: viewer.reviewer.id, name: viewer.reviewer.name };
  }
  const p = await getPrincipal(db, viewer.principal.id);
  return { kind: 'principal', principalId: viewer.principal.id, name: p?.name ?? viewer.principal.id };
}

/** Start a thread. The anchor is resolved against the document's CURRENT
 *  text; a quote the server can't find (e.g. script-generated) downgrades to
 *  its enclosing block, else to the whole document — never an error. */
export async function createThread(
  db: Database,
  viewer: CommentViewer,
  collection: string,
  documentId: string,
  input: NewCommentInput,
  now: string,
): Promise<CommentThread> {
  const body = cleanBody(input.body);
  const intent = cleanIntent(input.intent);
  const visibility = viewer.kind === 'principal' ? cleanVisibility(input.visibility) : null;
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  const def = await loadDef(db, collection);
  const doc = await dq.getDocument(db, collection, documentId, grant);
  if (!doc) throw new NotFoundError('Document');

  const anchor = resolveAnchor(input.anchor ?? { kind: 'document' }, canonicalDocument(def, doc.data));
  const id = await cq.insertComment(
    db,
    {
      documentId,
      threadId: null,
      author: await authorFor(viewer, db),
      visibility,
      anchor,
      anchorRevision: doc.revision,
      body,
      intent,
      now,
      event: { type: 'comment.created', collection, resource: documentId, principalId: viewer.principal.id, at: now },
    },
    grant,
  );
  return { root: (await cq.getComment(db, id, grant))!, replies: [] };
}

/** The root of a thread the viewer may see on this document, or NotFound —
 *  a thread you can't see is indistinguishable from one that doesn't exist. */
async function visibleRoot(
  db: Database,
  viewer: CommentViewer,
  documentId: string,
  threadId: string,
  grant: Grant,
): Promise<cq.CommentRecord> {
  const root = await cq.getComment(db, threadId, grant);
  if (!root || root.documentId !== documentId || root.threadId !== null || !threadVisibleTo(root, viewer)) {
    throw new NotFoundError('Comment thread');
  }
  return root;
}

export async function replyToThread(
  db: Database,
  viewer: CommentViewer,
  collection: string,
  documentId: string,
  threadId: string,
  input: { readonly body: string },
  now: string,
): Promise<cq.CommentRecord> {
  const body = cleanBody(input.body);
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  const root = await visibleRoot(db, viewer, documentId, threadId, grant);
  const id = await cq.insertComment(
    db,
    {
      documentId,
      threadId: root.id,
      author: await authorFor(viewer, db),
      visibility: null,
      anchor: null,
      anchorRevision: null,
      body,
      intent: null,
      now,
      event: { type: 'comment.created', collection, resource: documentId, principalId: viewer.principal.id, at: now },
    },
    grant,
  );
  return (await cq.getComment(db, id, grant))!;
}

/** A review link's `comment` would pass `authorize()` for the anonymous link
 *  principal, so principal-only operations refuse it explicitly rather than
 *  relying on callers to pass the right kind of viewer. */
function assertAccountHolder(principal: Principal): void {
  if (principal.linkId || principal.id === 'anonymous') {
    throw new ForbiddenError('Only people with an account can resolve comment threads.');
  }
}

/** Resolve or reopen a thread — principals only (reviewers raise issues; the
 *  document's people decide when they're dealt with). Resolution is stamped
 *  with the document's current revision: "resolved in rev N". */
export async function setThreadResolved(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  threadId: string,
  resolved: boolean,
  now: string,
): Promise<cq.CommentRecord> {
  assertAccountHolder(principal);
  const viewer: CommentViewer = { kind: 'principal', principal };
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  const root = await visibleRoot(db, viewer, documentId, threadId, grant);
  const doc = await dq.getDocument(db, collection, documentId, grant);
  if (!doc) throw new NotFoundError('Document');
  const event = {
    type: resolved ? ('comment.resolved' as const) : ('comment.reopened' as const),
    collection,
    resource: documentId,
    principalId: principal.id,
    at: now,
  };
  await cq.setThreadStatus(
    db,
    root.id,
    resolved ? { status: 'resolved', by: principal.id, revision: doc.revision, at: now } : { status: 'open' },
    event,
    grant,
  );
  return (await cq.getComment(db, root.id, grant))!;
}

/** Check that every id names a thread on this document the principal may
 *  resolve — called BEFORE a save that promises to resolve them, so a typo
 *  fails the whole call instead of leaving a saved document with its threads
 *  still open. */
export async function assertResolvable(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  threadIds: readonly string[],
  now: string,
): Promise<void> {
  assertAccountHolder(principal);
  const viewer: CommentViewer = { kind: 'principal', principal };
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  for (const id of threadIds) await visibleRoot(db, viewer, documentId, id, grant);
}

/** Resolve several threads at once after a save that addressed them (the
 *  agent's `update_<slug>` with `resolves`). All ids are validated before any
 *  is resolved. */
export async function resolveThreads(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  threadIds: readonly string[],
  now: string,
): Promise<void> {
  await assertResolvable(db, principal, collection, documentId, threadIds, now);
  for (const id of threadIds) await setThreadResolved(db, principal, collection, documentId, id, true, now);
}

/**
 * The `review` render (D55): every thread this principal can see, with its quote
 * in context, as a markdown brief. Open threads come first, most urgent intent
 * first; resolved history last. `budget` caps approximate tokens.
 */
export async function renderReview(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  opts: { readonly budget?: number },
  now: string,
): Promise<string> {
  if (opts.budget !== undefined && !(Number.isInteger(opts.budget) && opts.budget > 0)) {
    throw new InputValidationError([{ path: 'budget', message: 'budget must be a positive integer.' }]);
  }
  const viewer: CommentViewer = { kind: 'principal', principal };
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  const def = await loadDef(db, collection);
  const doc = await dq.getDocument(db, collection, documentId, grant);
  if (!doc) throw new NotFoundError('Document');
  const rank = (t: CommentThread) =>
    t.root.status === 'resolved' ? 9 : t.root.intent === 'must_fix' ? 0 : t.root.intent === 'question' ? 1 : 2;
  const threads = assembleThreads(await cq.listCommentsForDocument(db, documentId, grant)).sort(
    (a, b) => rank(a) - rank(b),
  );
  return buildReviewBrief(
    {
      title: titleOf(def, doc),
      documentId,
      collection,
      revision: doc.revision,
      threads,
      reviewers: await cq.listReviewersForDocument(db, documentId),
    },
    opts.budget,
  );
}

/** Delete a comment (a root takes its replies with it). Authors may delete their
 *  own; principals who may `update` the document may delete any (moderation). */
export async function deleteComment(
  db: Database,
  viewer: CommentViewer,
  collection: string,
  documentId: string,
  commentId: string,
  now: string,
): Promise<void> {
  const grant = await authorizeComment(db, viewer, collection, documentId, now);
  const c = await cq.getComment(db, commentId, grant);
  if (!c || c.documentId !== documentId) throw new NotFoundError('Comment');
  const root = c.threadId ? await cq.getComment(db, c.threadId, grant) : c;
  if (!root || !threadVisibleTo(root, viewer)) throw new NotFoundError('Comment');

  const own =
    viewer.kind === 'principal'
      ? c.author.kind === 'principal' && c.author.principalId === viewer.principal.id
      : c.author.kind === 'reviewer' && c.author.reviewerId === viewer.reviewer.id;
  const moderator =
    viewer.kind === 'principal' &&
    (await canAuthorize(db, viewer.principal, 'update', { collection, documentId }, now));
  if (!own && !moderator) throw new ForbiddenError('You can only delete your own comments.');
  await cq.deleteComment(db, commentId, grant);
}

// ---------------------------------------------------------------------------
// Re-anchoring after a save — called by the documents service
// ---------------------------------------------------------------------------

/**
 * Re-locate every open thread's anchor against a just-saved revision. Runs under
 * the saving call's own grant (the caller already passed `authorize()` to write
 * the document) and is idempotent: if it fails, anchors stay as they were and the
 * next save retries. Admin and agent edits both come through here — the save
 * path is shared, so the behaviour can't differ between them.
 */
export async function reanchorComments(
  db: Database,
  grant: Grant,
  def: CollectionDefinition,
  doc: { readonly id: string; readonly data: Record<string, unknown>; readonly revision: number },
): Promise<void> {
  const roots = await cq.listOpenAnchoredRoots(db, doc.id, grant);
  const movable = roots.filter((r) => r.anchor && r.anchor.kind !== 'document');
  if (!movable.length) return;
  const fields = canonicalDocument(def, doc.data);
  await cq.updateAnchors(
    db,
    movable.map((r) => {
      const { anchor, status } = relocateAnchor(r.anchor!, fields);
      return { id: r.id, anchor, status, revision: doc.revision };
    }),
    grant,
  );
}

// ---------------------------------------------------------------------------
// Review links — managed from the Share panel, gated like share links
// ---------------------------------------------------------------------------

export interface ReviewLinkInput {
  readonly collection: string;
  readonly documentId: string;
  readonly mode: grantQ.ReviewMode;
  /** A personal link for this reviewer; omit for an open link where each
   *  reviewer types their name. */
  readonly reviewer?: { readonly name: string; readonly email?: string };
  readonly label?: string;
  readonly expiresAt?: string;
  readonly password?: string;
  readonly maxTtlDays?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createReviewLink(
  db: Database,
  principal: Principal,
  input: ReviewLinkInput,
  secret: string,
  now: string,
): Promise<{ grantId: string; token: string; reviewer: cq.ReviewerRecord | null }> {
  if (!(grantQ.REVIEW_MODES as readonly string[]).includes(input.mode)) {
    throw new InputValidationError([{ path: 'mode', message: "Mode must be 'group' or 'individual'." }]);
  }
  const name = input.reviewer ? cleanName(input.reviewer.name) : null;
  const email = input.reviewer?.email?.trim() || null;
  if (email && !EMAIL_RE.test(email)) {
    throw new InputValidationError([{ path: 'email', message: 'Enter a valid email address.' }]);
  }
  const link = await createShareLink(
    db,
    principal,
    {
      collection: input.collection,
      documentId: input.documentId,
      actions: ['read', 'comment'],
      reviewMode: input.mode,
      label: input.label ?? (name ? `Review: ${name}` : 'Open review link'),
      expiresAt: input.expiresAt,
      password: input.password,
      maxTtlDays: input.maxTtlDays,
    },
    secret,
    now,
  );
  const reviewer = name
    ? await cq.insertReviewer(
        db,
        { grantId: link.grantId, documentId: input.documentId, name, email, kind: 'invited' },
        now,
      )
    : null;
  return { grantId: link.grantId, token: link.token, reviewer };
}

export interface ReviewLinkListItem extends ShareLinkListItem {
  readonly reviewMode: grantQ.ReviewMode;
  readonly reviewers: readonly cq.ReviewerRecord[];
  /** Personal (one invited reviewer) vs open (self-named reviewers). */
  readonly personal: boolean;
}

/** The document's review links with their reviewers (Share panel). */
export async function listReviewLinks(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  secret: string,
  baseUrl: string,
  now: string,
): Promise<ReviewLinkListItem[]> {
  const links = await listShareLinks(db, principal, collection, documentId, secret, baseUrl, now);
  const reviewers = await cq.listReviewersForDocument(db, documentId);
  return links.filter(isReviewLink).map((l) => {
    const mine = reviewers.filter((r) => r.grantId === l.id);
    return { ...l, reviewMode: l.reviewMode!, reviewers: mine, personal: mine.some((r) => r.kind === 'invited') };
  });
}

async function reviewLinkOnDocument(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  grantId: string,
  now: string,
): Promise<grantQ.ItemGrantRecord> {
  await authorize(db, principal, 'share_link', { collection, documentId }, now);
  const grant = (await grantQ.listGrantsForDocument(db, documentId)).find((g) => g.id === grantId);
  if (!grant || grant.subjectKind !== 'link' || !isReviewLink(grant)) throw new NotFoundError('Review link');
  return grant;
}

/** What flipping a review link's mode would re-scope — the numbers for the
 *  confirmation warning ("This will make 14 comments from 3 reviewers visible
 *  to everyone reviewing this document"). */
export async function previewReviewModeFlip(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  grantId: string,
  now: string,
): Promise<{ readonly from: grantQ.ReviewMode; readonly to: grantQ.ReviewMode; readonly comments: number; readonly reviewers: number }> {
  const grant = await reviewLinkOnDocument(db, principal, collection, documentId, grantId, now);
  const from = grant.reviewMode!;
  const counts = await cq.countRootsByGrant(db, grantId);
  return { from, to: from === 'group' ? 'individual' : 'group', ...counts };
}

/** Set a review link's mode. Past comments made through it follow at once. */
export async function setReviewMode(
  db: Database,
  principal: Principal,
  collection: string,
  documentId: string,
  grantId: string,
  mode: grantQ.ReviewMode,
  now: string,
): Promise<void> {
  if (!(grantQ.REVIEW_MODES as readonly string[]).includes(mode)) {
    throw new InputValidationError([{ path: 'mode', message: "Mode must be 'group' or 'individual'." }]);
  }
  await reviewLinkOnDocument(db, principal, collection, documentId, grantId, now);
  await grantQ.setGrantReviewMode(db, grantId, mode);
}
