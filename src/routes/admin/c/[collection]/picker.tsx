import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { getCollectionOrThrow } from '@/services/collections';
import { listDocuments } from '@/services/documents';
import { searchSite } from '@/services/search';
import { titleOf } from '@/lib/def-helpers';
import { hasLifecycle } from '@/lib/lifecycle';
import { nowIso } from '@/lib/now';
import { Badge } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** Options per fragment — a dropdown-sized window, not a list page. */
const PICKER_LIMIT = 8;
const QUERY_MAX = 100;

/**
 * GET /admin/c/:collection/picker?q= — the relation-picker FRAGMENT: a bare
 * listbox of documents in the target collection that the relation-picker island
 * fetches into its dropdown. With a query it is the collection-scoped full-text
 * search; without one, the most recently updated documents. Both reads are
 * `authorize('read')`-gated in the service, so the picker can only ever offer
 * what this principal may read. No AdminShell, no <form>, and nothing
 * focusable — the island owns keyboard handling from the search input.
 */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const slug = pathParam(c, 'collection');
  const now = nowIso();
  const def = await getCollectionOrThrow(db, slug);
  const q = (c.req.query('q') ?? '').trim().slice(0, QUERY_MAX);

  const options = q
    ? (await searchSite(db, principal, { q, collection: slug, limit: PICKER_LIMIT }, now)).hits.map((h) => ({
        id: h.id,
        title: h.title ?? h.id,
        status: h.status,
      }))
    : (await listDocuments(db, principal, slug, { pageSize: PICKER_LIMIT }, now)).rows.map((d) => ({
        id: d.id,
        title: titleOf(def, d),
        status: d.status,
      }));
  const showStatus = hasLifecycle(def);

  return c.html(
    <ul role="listbox" aria-label={`${def.name} matches`} class="flex flex-col">
      {options.map((o) => (
        <li
          role="option"
          aria-selected="false"
          data-id={o.id}
          data-title={o.title}
          class="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-sm text-ink hover:bg-hover aria-selected:bg-hover"
        >
          <span class="truncate">{o.title}</span>
          {showStatus ? (
            <Badge tone={o.status === 'published' ? 'success' : 'neutral'}>{o.status}</Badge>
          ) : null}
        </li>
      ))}
      {/* Shown by the island when every option is filtered out (already linked),
          and by the server when the search itself found nothing. */}
      <li data-relation-empty class={options.length ? 'hidden px-2.5 py-2 text-sm text-ink-muted' : 'px-2.5 py-2 text-sm text-ink-muted'}>
        {q ? `No ${def.name.toLowerCase()} match “${q}”.` : `No ${def.name.toLowerCase()} to link yet.`}
      </li>
    </ul>,
  );
});
