/**
 * GET /admin/search — site-wide full-text search (D28). One query across every
 * collection the signed-in principal can read (the service composes the compiled
 * read predicate per collection in-query), grouped by collection, snippets
 * relevance-ranked. Reached from the shell's header search box.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { searchSite, type SearchHit } from '@/services/search';
import { snippetToHtml } from '@/lib/fts';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, Card, CardContent, Badge, EmptyState, Button } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

const PAGE_SIZE = 20;

function groupByCollection(hits: readonly SearchHit[]): Map<string, SearchHit[]> {
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const list = groups.get(h.collection) ?? [];
    list.push(h);
    groups.set(h.collection, list);
  }
  return groups;
}

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const q = (c.req.query('q') ?? '').trim();
  const page = Math.max(1, Number(c.req.query('page')) || 1);

  const result = q
    ? await searchSite(db, principal, { q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, nowIso())
    : { hits: [], hasMore: false, limit: PAGE_SIZE, offset: 0 };
  const groups = groupByCollection(result.hits);
  const pageHref = (p: number) => `/admin/search?q=${encodeURIComponent(q)}&page=${p}`;

  return c.render(
    <AdminShell user={user} current="search">
      <PageHeader
        title="Search"
        description={
          q
            ? `Results for “${q}” across everything you can read.`
            : 'Type in the search box above — words are matched together; the last word matches prefixes.'
        }
      />

      {q && result.hits.length === 0 ? (
        <EmptyState
          title="No matches"
          description={`Nothing you can read matches “${q}”. New and edited documents are indexed on save.`}
        />
      ) : null}

      <div class="space-y-6">
        {[...groups.entries()].map(([collection, hits]) => (
          <Card>
            <CardContent class="pt-4">
              <h2 class="mb-3 font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
                {collection}
              </h2>
              <ol class="divide-y divide-border">
                {hits.map((h) => (
                  <li class="py-3 first:pt-0 last:pb-0">
                    <div class="flex items-center gap-2">
                      <a
                        href={`/admin/c/${h.collection}/${h.id}`}
                        class="font-medium text-accent-text hover:underline"
                      >
                        {h.title ?? h.id}
                      </a>
                      <Badge tone={h.status === 'published' ? 'accent' : 'neutral'}>{h.status}</Badge>
                    </div>
                    {/* Safe by construction: snippetToHtml HTML-escapes the whole
                        snippet BEFORE swapping the char(1)/char(2) sentinels for
                        <mark> (src/lib/fts.ts). */}
                    <p
                      class="mt-1 text-sm text-ink-muted [&_mark]:rounded-sm [&_mark]:bg-accent/20 [&_mark]:px-0.5 [&_mark]:text-ink"
                      dangerouslySetInnerHTML={{ __html: snippetToHtml(h.snippet) }}
                    />
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>

      {q && (page > 1 || result.hasMore) ? (
        <nav aria-label="Search result pages" class="mt-6 flex items-center justify-between">
          {page > 1 ? (
            <Button href={pageHref(page - 1)} variant="secondary" size="sm">
              Previous
            </Button>
          ) : (
            <span />
          )}
          {result.hasMore ? (
            <Button href={pageHref(page + 1)} variant="secondary" size="sm">
              Next
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </AdminShell>,
  );
});
