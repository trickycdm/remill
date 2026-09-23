/**
 * The `review` text render (D55) — a document's review threads as one markdown
 * brief an agent can reason over in a single call. Pure: the comments service
 * gathers the data, this shapes it.
 *
 * It does NOT reproduce the document. Each thread carries its quote in context
 * (`…before {==quote==} after…`), which is what an agent needs to find the
 * passage in the source it fetches with `get_<slug>`. Budget priorities put
 * open must-fix threads first and resolved threads last, so a tight budget
 * drops history before it drops live feedback.
 */

import { applyBudget } from '@/templates/renders';
import type { CommentRecord, ReviewerRecord } from '@/db/queries/comments';

export interface ReviewBriefInput {
  readonly title: string;
  readonly documentId: string;
  readonly collection: string;
  readonly revision: number;
  readonly threads: readonly { readonly root: CommentRecord; readonly replies: readonly CommentRecord[] }[];
  readonly reviewers: readonly ReviewerRecord[];
}

const INTENT_LABEL: Record<string, string> = {
  must_fix: 'must fix',
  question: 'question',
  suggestion: 'suggestion',
  nit: 'nit',
  praise: 'praise',
};

function priorityOf(root: CommentRecord): number {
  if (root.status === 'resolved') return 9;
  if (root.intent === 'must_fix') return 1;
  if (root.intent === 'question') return 2;
  if (root.intent === 'praise') return 4;
  return 3;
}

function who(c: CommentRecord): string {
  return c.author.kind === 'reviewer' ? `${c.author.name} (reviewer)` : c.author.name;
}

/** One line of prose from a comment body (bodies are plain text; newlines
 *  would break the quote/list structure). */
function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ⏎ ');
}

function whereLine(root: CommentRecord): string {
  const a = root.anchor;
  if (!a || a.kind === 'document') {
    return a?.quote ? `On the whole document (reviewer selected: "${a.quote}")` : 'On the whole document';
  }
  const stale =
    root.anchorStatus === 'outdated'
      ? ` — ⚠ OUTDATED: no longer found in the document (last matched at revision ${root.anchorRevision})`
      : '';
  if (a.kind === 'block') return `On block \`${a.blockId}\` in \`${a.field}\`${stale}`;
  return `> …${a.prefix}{==${a.quote}==}${a.suffix}…\n\nIn \`${a.field}\`${stale}`;
}

function threadSection(n: number, root: CommentRecord, replies: readonly CommentRecord[]): string {
  const intent = root.intent ? ` · ${INTENT_LABEL[root.intent]}` : '';
  const status =
    root.status === 'resolved' ? `resolved in revision ${root.resolvedRevision}` : 'open';
  const visibility = root.author.kind === 'principal' ? ` · ${root.visibility}` : '';
  const lines = [
    `### ${n}. ${status}${intent} — ${who(root)}${visibility}`,
    whereLine(root),
    oneLine(root.body),
    ...replies.map((r) => `- **${who(r)}**: ${oneLine(r.body)}`),
    `\`threadId: ${root.id}\``,
  ];
  return lines.join('\n\n');
}

export function buildReviewBrief(input: ReviewBriefInput, budgetTokens?: number): string {
  const open = input.threads.filter((t) => t.root.status !== 'resolved');
  const outdated = open.filter((t) => t.root.anchorStatus === 'outdated').length;
  const reviewerLine = input.reviewers.length
    ? input.reviewers
        .map((r) => `${r.name} (${r.doneAt ? 'done' : 'still reviewing'})`)
        .join(', ')
    : 'none yet';
  const header = [
    `# Review: ${input.title}`,
    `\`${input.collection}\` · \`${input.documentId}\` · current revision ${input.revision}`,
    `${open.length} open thread(s)${outdated ? `, ${outdated} outdated` : ''}, ${input.threads.length - open.length} resolved.`,
    `Reviewers: ${reviewerLine}`,
    'Pass `expectedRevision` when you save, and `resolves: [threadId, …]` for the threads the save addresses.',
  ].join('\n\n');

  const sections = [
    { priority: 0, text: header },
    ...input.threads.map((t, i) => ({ priority: priorityOf(t.root), text: threadSection(i + 1, t.root, t.replies) })),
  ];
  return applyBudget(sections, budgetTokens);
}
