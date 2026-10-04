/**
 * Document review in the editor rail (D55): `CommentsSection` summarises the
 * open threads with deep links into the review overlay, where commenting and
 * resolving happen in context. It shows only the newest few — the overlay is
 * the place to read them all, and a bounded list keeps the rail short enough
 * to never need its own scrollbar.
 *
 * Review LINKS (who may comment) are managed in the Share drawer
 * (share-drawer.tsx), alongside read-only links.
 */

import type { CommentThread } from '@/services/comments';
import { RailSection } from '@/components/admin/editor-sidebar';
import { Button } from '@/components/ui';

/** Open threads previewed in the rail. */
const RAIL_THREADS = 3;

export function reviewOverlayHref(slug: string, id: string, threadId?: string): string {
  return `/${slug}/${id}?preview=1&review=1${threadId ? `#comment-${threadId}` : ''}`;
}

export function CommentsSection({
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
    <RailSection title="Comments">
      <p class="text-sm text-ink-muted">
        {open.length} open{outdated ? ` · ${outdated} outdated` : ''} · {threads.length - open.length} resolved
      </p>
      {open.length ? (
        <ul class="flex flex-col gap-2.5">
          {open.slice(0, RAIL_THREADS).map(({ root, replies }) => (
            <li class="flex flex-col gap-0.5 text-sm">
              <a
                href={reviewOverlayHref(slug, id, root.id)}
                target="_blank"
                rel="noopener"
                class="line-clamp-2 rounded-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
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
      <Button href={reviewOverlayHref(slug, id)} variant="secondary" size="sm" class="self-start" target="_blank" rel="noopener">
        {open.length > RAIL_THREADS ? `Open review (${open.length - RAIL_THREADS} more) ↗` : 'Open review ↗'}
      </Button>
    </RailSection>
  );
}
