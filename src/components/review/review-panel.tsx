/**
 * The review panel (D55) — the server-rendered half of the review overlay on a
 * reading page. One component for both kinds of commenter: a reviewer on a
 * review link (`/s/<token>/review/*` endpoints) and a signed-in principal
 * previewing their document (`/admin/c/<slug>/<id>/review/*`).
 *
 * Every form posts with Datastar (form encoding) and every endpoint answers
 * with this whole panel, morphed by its id (DATASTAR_PATTERNS §d) — so the
 * panel is always a fresh server render of the truth. The island
 * (src/client/review.ts) only captures selections into the composer and paints
 * highlights from the `data-rm-*` attributes on each thread card. With no JS,
 * everything except text selection still works: comment on the whole document
 * or on a named figure, reply, resolve.
 *
 * Comment bodies are plain text, escaped by JSX; `whitespace-pre-wrap` keeps
 * their line breaks.
 */

import type { CommentRecord, CommentIntent } from '@/db/queries/comments';
import type { CommentThread, ReviewMode } from '@/services/comments';
import { COMMENT_INTENTS, MAX_COMMENT_CHARS, MAX_REVIEWER_NAME_CHARS } from '@/services/comments';
import { Badge, Button, FormField, Input, Select, Textarea } from '@/components/ui';

export const REVIEW_PANEL_ID = 'rm-review-panel';

const INTENT_LABEL: Record<CommentIntent, string> = {
  must_fix: 'Must fix',
  question: 'Question',
  suggestion: 'Suggestion',
  nit: 'Nit',
  praise: 'Praise',
};

export type ReviewPanelViewer =
  | { readonly kind: 'principal'; readonly principalId: string; readonly canModerate: boolean }
  | {
      readonly kind: 'reviewer';
      readonly reviewerId: string;
      readonly name: string;
      readonly mode: ReviewMode;
      readonly done: boolean;
    }
  | { readonly kind: 'needs_name' };

export interface ReviewPanelProps {
  /** Endpoint base: `/s/<token>/review` or `/admin/c/<slug>/<id>/review`. */
  readonly base: string;
  readonly viewer: ReviewPanelViewer;
  readonly threads: readonly CommentThread[];
  readonly blocks: readonly { readonly id: string; readonly field: string }[];
  /** A one-line outcome or error to announce at the top (role=status/alert). */
  readonly flash?: { readonly tone: 'status' | 'error'; readonly message: string };
}

/** `@post` as a form submission — the Datastar form idiom (DATASTAR_PATTERNS §b). */
function post(url: string): string {
  return `@post('${url}', {contentType: 'form'})`;
}

function isOwn(c: CommentRecord, viewer: ReviewPanelViewer): boolean {
  if (viewer.kind === 'principal') return c.author.kind === 'principal' && c.author.principalId === viewer.principalId;
  if (viewer.kind === 'reviewer') return c.author.kind === 'reviewer' && c.author.reviewerId === viewer.reviewerId;
  return false;
}

function AuthorLine({ c }: { c: CommentRecord }) {
  return (
    <p class="text-xs text-ink-muted">
      <span class="font-medium text-ink">{c.author.name}</span>
      {c.author.kind === 'reviewer' ? ' · reviewer' : ''}
      {' · '}
      <time datetime={c.createdAt}>{c.createdAt.slice(0, 10)}</time>
    </p>
  );
}

function AnchorSummary({ root }: { root: CommentRecord }) {
  const a = root.anchor;
  const outdated =
    root.anchorStatus === 'outdated' ? (
      <Badge tone="warning">Outdated — text changed</Badge>
    ) : null;
  if (!a || a.kind === 'document') {
    return (
      <div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>On the whole document</span>
        {a?.quote ? <span class="italic">(selected “{a.quote}”)</span> : null}
      </div>
    );
  }
  if (a.kind === 'block') {
    return (
      <div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>
          On figure <code class="font-mono">{a.blockId}</code>
        </span>
        {outdated}
      </div>
    );
  }
  return (
    <div class="flex flex-col gap-1">
      <blockquote class="line-clamp-3 border-l-2 border-warning pl-2 text-sm text-ink">{a.quote}</blockquote>
      {outdated}
    </div>
  );
}

/** The data the island needs to paint this thread's highlight. */
function anchorAttrs(root: CommentRecord): Record<string, string> {
  const a = root.anchor;
  const attrs: Record<string, string> = {
    'data-rm-thread': root.id,
    'data-rm-status': root.status ?? 'open',
  };
  if (!a || root.anchorStatus === 'outdated') return attrs;
  if (a.kind === 'text') {
    return {
      ...attrs,
      'data-rm-anchor-kind': 'text',
      'data-rm-anchor-field': a.field,
      'data-rm-anchor-quote': a.quote,
      'data-rm-anchor-prefix': a.prefix,
      'data-rm-anchor-suffix': a.suffix,
      'data-rm-anchor-start': String(a.start),
    };
  }
  if (a.kind === 'block') {
    return { ...attrs, 'data-rm-anchor-kind': 'block', 'data-rm-anchor-field': a.field, 'data-rm-anchor-block': a.blockId };
  }
  return attrs;
}

function ThreadCard({
  base,
  thread,
  viewer,
}: {
  base: string;
  thread: CommentThread;
  viewer: ReviewPanelViewer;
}) {
  const { root, replies } = thread;
  const resolved = root.status === 'resolved';
  const canResolve = viewer.kind === 'principal';
  const canDelete = (c: CommentRecord) =>
    isOwn(c, viewer) || (viewer.kind === 'principal' && viewer.canModerate);
  // Per-render id so a posted reply's text isn't carried over by the morph
  // (see Composer).
  const replyId = `reply-${root.id}-${crypto.randomUUID().slice(0, 8)}`;
  return (
    <article
      id={`comment-${root.id}`}
      tabindex={-1}
      class="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Comment by ${root.author.name}`}
      {...anchorAttrs(root)}
    >
      <div class="flex flex-wrap items-center gap-2">
        {root.intent ? <Badge tone={root.intent === 'must_fix' ? 'danger' : 'neutral'}>{INTENT_LABEL[root.intent]}</Badge> : null}
        {resolved ? <Badge tone="success">Resolved · rev {root.resolvedRevision}</Badge> : null}
        {root.author.kind === 'principal' && root.visibility === 'internal' ? (
          <Badge tone="info">Internal</Badge>
        ) : null}
      </div>
      <AnchorSummary root={root} />
      <div class="flex flex-col gap-1">
        <AuthorLine c={root} />
        <p class="whitespace-pre-wrap text-sm text-ink">{root.body}</p>
      </div>
      {replies.length ? (
        <ul class="flex flex-col gap-2 border-l border-border pl-3" aria-label="Replies">
          {replies.map((r) => (
            <li class="flex flex-col gap-1">
              <AuthorLine c={r} />
              <p class="whitespace-pre-wrap text-sm text-ink">{r.body}</p>
              {canDelete(r) ? (
                <form data-on:submit={post(`${base}/comments/${r.id}/delete`)}>
                  <Button type="submit" variant="link" class="text-xs">
                    Delete reply
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {viewer.kind !== 'needs_name' ? (
        <form class="flex flex-col gap-2" data-on:submit={post(`${base}/comments/${root.id}/replies`)}>
          <label for={replyId} class="sr-only">
            Reply to {root.author.name}
          </label>
          <Textarea id={replyId} name="body" rows={2} required maxlength={MAX_COMMENT_CHARS} placeholder="Reply…" />
          <div>
            <Button type="submit" size="sm" variant="secondary">
              Reply
            </Button>
          </div>
        </form>
      ) : null}
      {/* Sibling forms, never nested — the HTML parser drops a nested <form>. */}
      <div class="flex flex-wrap items-center gap-3">
        {canResolve ? (
          <form data-on:submit={post(`${base}/comments/${root.id}/resolve`)}>
            <input type="hidden" name="resolved" value={resolved ? '0' : '1'} />
            <Button type="submit" size="sm" variant="ghost">
              {resolved ? 'Reopen' : 'Resolve'}
            </Button>
          </form>
        ) : null}
        {canDelete(root) ? (
          <form data-on:submit={post(`${base}/comments/${root.id}/delete`)}>
            <Button type="submit" variant="link" class="text-xs">
              Delete thread
            </Button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function Composer({
  base,
  viewer,
  blocks,
}: {
  base: string;
  viewer: ReviewPanelViewer;
  blocks: ReviewPanelProps['blocks'];
}) {
  // Fresh ids per render — for the form AND every control in it. The panel
  // morphs by id (DATASTAR_PATTERNS §d), and the morph carries any element
  // whose id matches across, live state included, even into a new parent: a
  // reused id would carry the last comment's target and quote into the next.
  // The island finds the composer by attribute, never by id.
  const n = crypto.randomUUID().slice(0, 8);
  return (
    <form
      id={`rm-review-composer-${n}`}
      data-rm-composer
      class="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
      data-on:submit={post(`${base}/comments`)}
    >
      <h3 class="text-sm font-semibold text-ink">New comment</h3>
      {/* Filled by the island from the reader's text selection. */}
      <input type="hidden" name="anchor" value="" data-rm-anchor-input />
      <blockquote
        class="hidden line-clamp-3 border-l-2 border-warning pl-2 text-sm text-ink"
        data-rm-quote-preview
        aria-live="polite"
      />
      <FormField fieldId={`rm-review-target-${n}`} label="Commenting on">
        <Select id={`rm-review-target-${n}`} name="target">
          <option value="selection" disabled data-rm-selection-option>
            Selected text (select text in the page)
          </option>
          <option value="document" selected>
            The whole document
          </option>
          {blocks.map((b) => (
            <option value={`block:${b.id}`}>Figure: {b.id.startsWith('img:') ? `image ${b.id.slice(4)}` : b.id}</option>
          ))}
        </Select>
      </FormField>
      <FormField fieldId={`rm-review-body-${n}`} label="Comment" required>
        <Textarea id={`rm-review-body-${n}`} name="body" rows={4} required maxlength={MAX_COMMENT_CHARS} />
      </FormField>
      <div class="grid grid-cols-2 gap-3">
        <FormField fieldId={`rm-review-intent-${n}`} label="Type">
          <Select id={`rm-review-intent-${n}`} name="intent">
            <option value="">Comment</option>
            {COMMENT_INTENTS.map((i) => (
              <option value={i}>{INTENT_LABEL[i]}</option>
            ))}
          </Select>
        </FormField>
        {viewer.kind === 'principal' ? (
          <FormField fieldId={`rm-review-visibility-${n}`} label="Visible to">
            <Select id={`rm-review-visibility-${n}`} name="visibility">
              <option value="internal">Only people with accounts</option>
              <option value="shared">Reviewers too</option>
            </Select>
          </FormField>
        ) : null}
      </div>
      <Button type="submit" size="sm">
        Add comment
      </Button>
    </form>
  );
}

function ReviewerHeader({ base, viewer }: { base: string; viewer: Extract<ReviewPanelViewer, { kind: 'reviewer' }> }) {
  return (
    <div class="flex flex-col gap-2">
      <p class="text-sm text-ink">
        Reviewing as <span class="font-semibold">{viewer.name}</span>
      </p>
      {viewer.mode === 'individual' ? (
        <p class="text-xs text-ink-muted">
          Your comments are visible to the document owner. The owner may later share them with other reviewers.
        </p>
      ) : (
        <p class="text-xs text-ink-muted">Other reviewers on group links can see your comments.</p>
      )}
      <form data-on:submit={post(`${base}/done`)}>
        <input type="hidden" name="done" value={viewer.done ? '0' : '1'} />
        <Button type="submit" size="sm" variant={viewer.done ? 'ghost' : 'secondary'}>
          {viewer.done ? 'Done ✓ — reopen my review' : "I'm done reviewing"}
        </Button>
      </form>
    </div>
  );
}

function NameForm({ base }: { base: string }) {
  return (
    <form class="flex flex-col gap-3" data-on:submit={post(`${base}/identify`)}>
      <p class="text-sm text-ink">Your name is shown next to your comments.</p>
      <FormField fieldId="rm-review-name" label="Your name" required>
        <Input id="rm-review-name" name="name" required maxlength={MAX_REVIEWER_NAME_CHARS} autocomplete="name" />
      </FormField>
      <Button type="submit" size="sm">
        Start reviewing
      </Button>
    </form>
  );
}

export function ReviewPanel({ base, viewer, threads, blocks, flash }: ReviewPanelProps) {
  const open = threads.filter((t) => t.root.status !== 'resolved');
  const resolved = threads.filter((t) => t.root.status === 'resolved');
  return (
    <aside
      id={REVIEW_PANEL_ID}
      // Focusable so the "Go to comments" links land keyboard focus here, not
      // just scroll (on wide screens the panel is fixed and never scrolls).
      tabindex={-1}
      class="rm-review-panel flex flex-col gap-4 border-l border-border bg-surface p-4 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label="Review comments"
      data-rm-review
    >
      {/* Narrow screens: the panel flows after the article, so a reader at the
          top can't see it — a sticky jump button keeps it one tap away. */}
      <a
        href={`#${REVIEW_PANEL_ID}`}
        class="fixed right-4 bottom-4 z-40 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
      >
        Comments ({open.length})
      </a>
      <header class="flex flex-col gap-2">
        <h2 class="font-display text-lg text-ink">
          Review <span class="text-sm font-normal text-ink-muted">· {open.length} open</span>
        </h2>
        <p class="text-sm text-ink-muted">
          {viewer.kind === 'needs_name'
            ? 'Add your name below, then select any text in the page to comment on it.'
            : 'Select any text in the page to comment on it, or leave a general comment below.'}
        </p>
        {viewer.kind === 'reviewer' ? <ReviewerHeader base={base} viewer={viewer} /> : null}
      </header>
      {flash ? (
        <p
          role={flash.tone === 'error' ? 'alert' : 'status'}
          class={
            flash.tone === 'error'
              ? 'rounded-md bg-danger-soft px-3 py-2 text-sm text-danger'
              : 'rounded-md bg-success-soft px-3 py-2 text-sm text-success'
          }
        >
          {flash.message}
        </p>
      ) : null}
      {viewer.kind === 'needs_name' ? <NameForm base={base} /> : <Composer base={base} viewer={viewer} blocks={blocks} />}
      <section class="flex flex-col gap-3" aria-label="Open comments">
        {open.length ? (
          open.map((t) => <ThreadCard base={base} thread={t} viewer={viewer} />)
        ) : (
          <p class="text-sm text-ink-muted">No open comments yet.</p>
        )}
      </section>
      {resolved.length ? (
        <details class="flex flex-col gap-3">
          <summary class="cursor-pointer text-sm text-ink-muted">Resolved ({resolved.length})</summary>
          <div class="mt-3 flex flex-col gap-3">
            {resolved.map((t) => (
              <ThreadCard base={base} thread={t} viewer={viewer} />
            ))}
          </div>
        </details>
      ) : null}
    </aside>
  );
}
