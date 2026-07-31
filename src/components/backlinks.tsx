/**
 * Backlinks — the "Referenced by" reverse edges (B3), shared by the generic
 * DocumentView (admin + shell-mode public) and the reading templates. `surface`
 * routes each referrer's href to the public page vs the admin detail view.
 * Renders nothing when there are no referrers.
 */

import type { Backlink } from '@/services/documents';

export function Backlinks({
  backlinks,
  surface,
  class: cls,
}: {
  backlinks: Backlink[];
  surface: 'admin' | 'public';
  class?: string;
}) {
  if (!backlinks.length) return null;
  const href = (b: Backlink) =>
    surface === 'public' ? `/${b.collection}/${b.id}` : `/admin/c/${b.collection}/${b.id}`;
  return (
    <section
      aria-labelledby="rm-backlinks-h"
      class={`mt-4 border-t border-border pt-6${cls ? ` ${cls}` : ''}`}
    >
      <h2 id="rm-backlinks-h" class="font-display text-lg font-semibold tracking-tight text-ink">
        Referenced by
      </h2>
      <ul class="mt-3 flex flex-col gap-2">
        {backlinks.map((b) => (
          <li class="flex flex-wrap items-center gap-2">
            <a href={href(b)} class="text-accent-text hover:underline">
              {b.title ?? b.id}
            </a>
            <span class="text-xs text-ink-subtle">{b.collection}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
