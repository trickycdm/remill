/**
 * GET /admin — the dashboard: the Nebulae graph as the hero (the product's
 * signature view, D45), a stat row (collections / documents / drafts /
 * relations), the freshest collections, and — for admins — the newest audit
 * rows. Everything is principal-scoped: contentOverview counts run through the
 * compiled read filter, graphData only maps readable items, and the audit feed
 * is admin-only UI-hiding over the manage_access-gated listAudit service.
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { listAudit } from '@/services/access';
import { contentOverview, graphData, type ContentOverviewItem } from '@/services/documents';
import { hasLifecycle } from '@/lib/lifecycle';
import { relativeTime } from '@/lib/relative-time';
import { AdminShell } from '@/components/layouts/admin-shell';
import { GraphPanel } from '@/components/admin/graph-panel';
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  EmptyState,
  Badge,
  Button,
  Stamp,
  Waypoints,
  ArrowRight,
} from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

/** One stat tile: mono eyebrow label over a large plain-sans figure. */
function StatTile({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <a
      href={href}
      class="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-5 transition-shadow hover:shadow-md"
    >
      <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
        {label}
      </span>
      <span class="text-3xl font-semibold text-ink">{value}</span>
    </a>
  );
}

/** The freshest-collections row meta ("3 published · 1 draft"). */
function countsLine(it: ContentOverviewItem): string {
  if (!it.counts) return '';
  const { published, draft } = it.counts;
  const total = published + draft;
  if (total === 0) return 'Empty';
  if (!hasLifecycle(it.def)) return `${total} document${total === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (published > 0) parts.push(`${published} published`);
  if (draft > 0) parts.push(`${draft} draft${draft === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const isAdmin = user.role === 'admin';

  const overview = (await contentOverview(db, principal, now)).filter(
    (it) => it.def.slug !== 'media',
  );
  const graph = await graphData(db, principal, now);
  const audit = isAdmin ? await listAudit(db, principal, now, 8) : [];

  const totals = overview.reduce(
    (acc, it) => ({
      documents: acc.documents + (it.counts ? it.counts.published + it.counts.draft : 0),
      drafts: acc.drafts + (it.counts?.draft ?? 0),
    }),
    { documents: 0, drafts: 0 },
  );
  const freshest = overview
    .filter((it) => it.lastUpdatedAt)
    .sort((a, b) => (a.lastUpdatedAt! < b.lastUpdatedAt! ? 1 : -1))
    .slice(0, 6);

  return c.render(
    <AdminShell user={user} current="dashboard">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user.displayName}.`}
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

      {overview.length === 0 ? (
        <EmptyState
          title="Let's set this place up"
          description={
            isAdmin
              ? 'Install a content pack from the marketplace, or define a content type from scratch — its list view, edit form, API, and MCP tools are generated automatically.'
              : 'Ask an administrator to define a content type — once content exists, your universe appears here.'
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
        <div class="flex flex-col gap-6">
          {graph.nodes.length === 0 ? (
            <EmptyState
              icon={<Waypoints size={28} aria-hidden="true" />}
              title="Your universe is waiting"
              description="Create some content — and relations between items — and it appears here as a galaxy."
              action={<Button href="/admin/c">Start writing</Button>}
            />
          ) : (
            <GraphPanel
              graph={graph}
              heightClass="h-[44vh] min-h-[320px]"
              footer={
                <div class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
                  <span class="font-mono text-xs text-ink-subtle">
                    {graph.nodes.length} items · {graph.edges.length}
                    {graph.truncated ? '+' : ''} relations · drag to orbit
                  </span>
                  <a
                    href="/admin/graph"
                    class="ml-auto inline-flex items-center gap-1 font-mono text-xs text-accent-text hover:underline"
                  >
                    Open the graph
                    <ArrowRight size={14} aria-hidden="true" />
                  </a>
                </div>
              }
            />
          )}

          <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Collections"
              value={String(overview.length)}
              href={isAdmin ? '/admin/collections' : '/admin/c'}
            />
            <StatTile label="Documents" value={String(totals.documents)} href="/admin/c" />
            <StatTile label="Drafts" value={String(totals.drafts)} href="/admin/c" />
            <StatTile
              label="Relations"
              value={`${graph.edges.length}${graph.truncated ? '+' : ''}`}
              href="/admin/graph"
            />
          </div>

          <div class="grid items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Freshest content</CardTitle>
              </CardHeader>
              <CardContent>
                {freshest.length === 0 ? (
                  <EmptyState
                    title="Nothing yet"
                    description="Documents you and your agents author will surface here, newest first."
                  />
                ) : (
                  <>
                    <ol class="divide-y divide-border text-sm">
                      {freshest.map((it) => (
                        <li class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                          <a
                            href={`/admin/c/${it.def.slug}`}
                            class="font-medium text-ink hover:underline"
                          >
                            {it.def.name}
                          </a>
                          {it.def.shape === 'singleton' ? <Badge>Singleton</Badge> : null}
                          <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                            {countsLine(it)}
                          </span>
                          <span class="shrink-0 font-mono text-xs text-ink-subtle">
                            {relativeTime(it.lastUpdatedAt!, now)}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <a
                      href="/admin/c"
                      class="mt-3 inline-block text-sm text-accent-text hover:underline"
                    >
                      All content →
                    </a>
                  </>
                )}
              </CardContent>
            </Card>

            {isAdmin ? (
              <Card>
                <CardHeader>
                  <CardTitle>Recent activity</CardTitle>
                </CardHeader>
                <CardContent>
                  {audit.length === 0 ? (
                    <EmptyState
                      title="Nothing yet"
                      description="Activity from you and your agents will appear here once content exists."
                    />
                  ) : (
                    <>
                      <ol class="divide-y divide-border text-sm">
                        {audit.map((a) => (
                          <li class="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                            {a.allowed ? (
                              <Badge tone="success">allow</Badge>
                            ) : (
                              <Stamp tone="refuse">deny</Stamp>
                            )}
                            <span class="text-ink">{a.action}</span>
                            <span class="min-w-0 flex-1 truncate font-mono text-xs text-ink-subtle">
                              {a.resource}
                            </span>
                            <span class="shrink-0 font-mono text-xs text-ink-subtle">
                              {a.createdAt.slice(5, 16).replace('T', ' ')}
                            </span>
                          </li>
                        ))}
                      </ol>
                      <a
                        href="/admin/activity"
                        class="mt-3 inline-block text-sm text-accent-text hover:underline"
                      >
                        All activity →
                      </a>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Go to</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul class="divide-y divide-border text-sm">
                    {[
                      { href: '/admin/c', label: 'Content', hint: 'Browse and author documents' },
                      { href: '/admin/search', label: 'Search', hint: 'Full-text across collections' },
                      { href: '/admin/shared', label: 'Shared with me', hint: 'Items granted to you' },
                      { href: '/admin/media', label: 'Media', hint: 'Uploads and originals' },
                    ].map((l) => (
                      <li class="py-2.5 first:pt-0 last:pb-0">
                        <a href={l.href} class="group flex items-center gap-3">
                          <span class="font-medium text-ink group-hover:underline">{l.label}</span>
                          <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                            {l.hint}
                          </span>
                          <ArrowRight size={14} class="shrink-0 text-ink-subtle" aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </AdminShell>,
  );
});
