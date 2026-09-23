/**
 * Document review in the editor rail (D55):
 *
 *  - `ReviewLinksSection` — the Share card's review-link management: personal
 *    links (one named reviewer, optionally emailed) and open links (reviewers
 *    type their name), each in group or individual mode, with the reviewers
 *    and whether they're done. Flipping a mode goes through a confirmation
 *    page that states what becomes visible (share.tsx, op=review_mode_preview).
 *  - `CommentsCard` — a summary of the open threads with deep links into the
 *    review overlay, where commenting and resolving happen in context.
 *
 * Classic `<form method="post">` to the share handler, like the rest of the
 * Share card — no JS needed to manage links.
 */

import type { ReviewLinkListItem, CommentThread } from '@/services/comments';
import type { SiteSettings } from '@/services/settings';
import { formatDate } from '@/lib/format-date';
import { CopyField } from '@/components/admin/editor-sidebar';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input, Select } from '@/components/ui';

export function reviewOverlayHref(slug: string, id: string, threadId?: string): string {
  return `/${slug}/${id}?preview=1&review=1${threadId ? `#comment-${threadId}` : ''}`;
}

export function ReviewLinksSection({
  slug,
  id,
  links,
  action,
  settings,
}: {
  slug: string;
  id: string;
  links: readonly ReviewLinkListItem[];
  action: string;
  settings?: SiteSettings;
}) {
  return (
    <div class="flex flex-col gap-3 border-t border-border pt-4">
      <div class="flex items-center justify-between gap-2">
        <p class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">Review links</p>
        <a
          href={reviewOverlayHref(slug, id)}
          target="_blank"
          rel="noopener"
          class="text-sm font-medium text-accent-text hover:underline"
        >
          Open review ↗
        </a>
      </div>
      <p class="text-xs text-ink-muted">
        People with a review link can read this document and comment on it — no account needed.
      </p>
      {links.map((l) => (
        <div class="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="truncate text-sm font-medium text-ink">{l.label ?? 'Review link'}</span>
              <span class="flex flex-wrap items-center gap-1">
                <Badge tone={l.personal ? 'accent' : 'neutral'}>{l.personal ? 'Personal' : 'Open'}</Badge>
                <Badge tone={l.reviewMode === 'group' ? 'info' : 'neutral'}>
                  {l.reviewMode === 'group' ? 'Group' : 'Individual'}
                </Badge>
                <span class="font-mono text-xs text-ink-subtle">
                  {l.expiresAt ? `expires ${formatDate(l.expiresAt, settings)}` : 'never expires'}
                </span>
              </span>
            </div>
            <form method="post" action={action}>
              <input type="hidden" name="op" value="revoke_link" />
              <input type="hidden" name="grantId" value={l.id} />
              <Button type="submit" variant="ghost" size="sm">
                Revoke
              </Button>
            </form>
          </div>
          {l.reviewers.length ? (
            <ul class="flex flex-col gap-0.5 text-xs text-ink-muted" aria-label="Reviewers">
              {l.reviewers.map((r) => (
                <li>
                  {r.name} — {r.doneAt ? 'done' : 'reviewing'}
                </li>
              ))}
            </ul>
          ) : (
            <p class="text-xs text-ink-subtle">No reviewers yet.</p>
          )}
          {l.url ? <CopyField id={`review-link-url-${l.id}`} label="URL" value={l.url} mono /> : null}
          <form method="post" action={action}>
            <input type="hidden" name="op" value="review_mode_preview" />
            <input type="hidden" name="grantId" value={l.id} />
            <Button type="submit" variant="link" class="text-xs">
              {l.reviewMode === 'group' ? 'Switch to individual…' : 'Switch to group…'}
            </Button>
          </form>
        </div>
      ))}
      <details class="group">
        <summary class="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span class="transition-transform group-open:rotate-90" aria-hidden="true">
            ›
          </span>
          New review link
        </summary>
        <form method="post" action={action} class="mt-3 flex flex-col gap-3">
          <input type="hidden" name="op" value="review_link" />
          <FormField
            fieldId={`review-name-${id}`}
            label="Reviewer name (optional)"
            description="Leave blank for an open link where each reviewer types their name."
          >
            <Input id={`review-name-${id}`} name="reviewerName" size="sm" maxlength={60} />
          </FormField>
          <FormField fieldId={`review-email-${id}`} label="Email the link to (optional)">
            <Input id={`review-email-${id}`} name="reviewerEmail" type="email" size="sm" />
          </FormField>
          <FormField fieldId={`review-mode-${id}`} label="Reviewers see">
            <Select id={`review-mode-${id}`} name="mode" size="sm">
              <option value="group">Each other's comments (group)</option>
              <option value="individual">Only their own comments (individual)</option>
            </Select>
          </FormField>
          <FormField fieldId={`review-expiry-${id}`} label="Link expiry (optional)">
            <Input id={`review-expiry-${id}`} name="expiresAt" type="datetime-local" size="sm" />
          </FormField>
          <FormField fieldId={`review-password-${id}`} label="Password for reviewers (optional)">
            <Input id={`review-password-${id}`} name="password" type="password" size="sm" placeholder="At least 8 characters" />
          </FormField>
          <Button type="submit" variant="secondary" size="sm" class="w-full">
            Create review link
          </Button>
        </form>
      </details>
    </div>
  );
}

export function CommentsCard({
  slug,
  id,
  threads,
}: {
  slug: string;
  id: string;
  threads: readonly CommentThread[];
}) {
  const open = threads.filter((t) => t.root.status !== 'resolved');
  const outdated = open.filter((t) => t.root.anchorStatus === 'outdated').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Comments</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <p class="text-sm text-ink-muted">
          {open.length} open{outdated ? ` · ${outdated} outdated` : ''} · {threads.length - open.length} resolved
        </p>
        {open.length ? (
          <ul class="flex flex-col gap-2">
            {open.slice(0, 8).map(({ root, replies }) => (
              <li class="flex flex-col gap-0.5 text-sm">
                <a href={reviewOverlayHref(slug, id, root.id)} target="_blank" rel="noopener" class="line-clamp-2 text-ink hover:underline">
                  {root.body}
                </a>
                <span class="text-xs text-ink-muted">
                  {root.author.name}
                  {root.intent === 'must_fix' ? ' · must fix' : ''}
                  {root.anchorStatus === 'outdated' ? ' · outdated' : ''}
                  {replies.length ? ` · ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <Button href={reviewOverlayHref(slug, id)} variant="secondary" size="sm" target="_blank" rel="noopener">
          Open review ↗
        </Button>
      </CardContent>
    </Card>
  );
}
