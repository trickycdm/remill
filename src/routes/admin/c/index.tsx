import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { contentOverview, type ContentOverviewItem } from '@/services/documents';
import { hasLifecycle } from '@/lib/lifecycle';
import { relativeTime } from '@/lib/relative-time';
import { AdminShell } from '@/components/layouts/admin-shell';
import {
  PageHeader,
  EmptyState,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  Badge,
  Button,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** The card's one-line content summary — author-centric ("3 published · 1 draft"),
 *  falling back to the schema shape when the caller can't read the collection. */
function metaLine(it: ContentOverviewItem): string {
  if (!it.counts) {
    return `${it.def.fields.length} field${it.def.fields.length === 1 ? '' : 's'}`;
  }
  const { published, draft } = it.counts;
  const total = published + draft;
  if (it.def.shape === 'singleton') {
    if (total === 0) return 'Not created yet';
    return hasLifecycle(it.def) ? (published > 0 ? 'Published' : 'Draft') : 'Created';
  }
  if (total === 0) return 'No documents yet';
  if (!hasLifecycle(it.def)) return `${total} document${total === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (published > 0) parts.push(`${published} published`);
  if (draft > 0) parts.push(`${draft} draft${draft === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** GET /admin/c — the content home: pick a collection to browse/author. */
export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const now = nowIso();
  const items = (await contentOverview(getDb(c.env.DB), requirePrincipal(c), now)).filter(
    (it) => it.def.slug !== 'media',
  );
  const isAdmin = user.role === 'admin';

  return c.render(
    <AdminShell user={user} current="content">
      <PageHeader
        title="Content"
        description="Browse and author documents across your collections."
        actions={
          isAdmin ? (
            <div class="flex items-center gap-2">
              <Button href="/admin/marketplace" variant="ghost" size="sm">
                Marketplace
              </Button>
              <Button href="/admin/collections/new" variant="secondary" size="sm">
                New collection
              </Button>
            </div>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="No collections yet"
          description={
            isAdmin
              ? 'Install a content pack from the marketplace, or define a content type from scratch — its list and edit views are generated automatically.'
              : 'Ask an administrator to define a content type — its list and edit views are generated automatically.'
          }
          action={
            isAdmin ? (
              <div class="flex flex-wrap items-center justify-center gap-2">
                <Button href="/admin/marketplace">Browse the marketplace</Button>
                <Button href="/admin/collections/new" variant="secondary">
                  New collection
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <ul class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => {
            const singleton = it.def.shape === 'singleton';
            const empty = it.counts ? it.counts.published + it.counts.draft === 0 : false;
            // A populated singleton never offers create — /new would mint a second doc.
            const showNew = it.canCreate && (singleton ? it.counts != null && empty : true);
            const updated = it.lastUpdatedAt ? relativeTime(it.lastUpdatedAt, now) : '';
            return (
              <li class="relative flex">
                <Card class="flex w-full flex-col transition-shadow hover:shadow-md">
                  <CardHeader class="pb-5">
                    <div class="flex items-start justify-between gap-3">
                      <CardTitle>
                        {/* Stretched link — the ::after overlay makes the whole card
                            tappable; the footer action re-stacks above it. */}
                        <a
                          href={`/admin/c/${it.def.slug}`}
                          class="after:absolute after:inset-0 after:rounded-lg"
                        >
                          {it.def.name}
                        </a>
                      </CardTitle>
                      {singleton ? <Badge>Singleton</Badge> : null}
                    </div>
                    <CardDescription>{metaLine(it)}</CardDescription>
                  </CardHeader>
                  {updated || showNew ? (
                    <CardFooter class="mt-auto justify-between gap-3">
                      <span class="font-mono text-xs text-ink-subtle">
                        {updated ? `Updated ${updated}` : ''}
                      </span>
                      {showNew ? (
                        <Button
                          href={`/admin/c/${it.def.slug}/new`}
                          variant="secondary"
                          size="sm"
                          class="relative"
                        >
                          {singleton ? `Create ${it.def.name}` : `New ${it.def.name}`}
                        </Button>
                      ) : null}
                    </CardFooter>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AdminShell>,
  );
});
