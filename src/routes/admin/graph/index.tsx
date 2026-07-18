/**
 * GET /admin/graph — the Nebulae relation-graph explorer (D45). Every readable
 * item is a star; collections cluster as tilted galactic disks; cross-
 * collection relations arc between them. Rendered by the canvas island
 * (src/client/graph.ts) inside an rm-dark-act subtree — the graph is the
 * product's dark act in both admin themes.
 *
 * The route calls ONE service (graphData — routes never touch D1) and renders
 * through the shared GraphPanel (src/components/admin/graph-panel.tsx), which
 * owns the island wire format and the accessible baseline; the dashboard hero
 * embeds the same panel. This page adds the full-height canvas and the
 * per-collection legend chips ([data-graph-toggle]).
 */

import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { graphData } from '@/services/documents';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, EmptyState, Stamp, Waypoints } from '@/components/ui';
import { GraphPanel, graphCountsByCollection } from '@/components/admin/graph-panel';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const graph = await graphData(getDb(c.env.DB), requirePrincipal(c), nowIso());
  const countByCollection = graphCountsByCollection(graph);

  return c.render(
    <AdminShell user={user} current="graph">
      <PageHeader
        title="Graph"
        description="Your content as a universe: every item a star, every relation a thread. Drag to orbit; hover a star; click to open it."
      />

      {graph.truncated ? (
        <div class="mb-4">
          <Stamp tone="event">Showing the first slice — the full graph exceeds the cap</Stamp>
        </div>
      ) : null}

      {graph.nodes.length === 0 ? (
        <EmptyState
          icon={<Waypoints size={28} aria-hidden="true" />}
          title="Nothing to map yet"
          description="Create some content — and relations between items — and the universe appears here."
        />
      ) : (
        <GraphPanel
          graph={graph}
          footer={
            <div class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
              {graph.collections.map((col) => (
                <button
                  type="button"
                  data-graph-toggle={col.slug}
                  aria-pressed="true"
                  class="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-2.5 py-1 font-mono text-xs text-ink-muted transition-colors aria-pressed:border-accent aria-pressed:text-ink"
                >
                  <span data-graph-swatch class="inline-block h-2 w-2 rounded-full bg-accent"></span>
                  {col.name}
                  <span class="text-ink-subtle">{countByCollection.get(col.slug) ?? 0}</span>
                </button>
              ))}
              <span class="ml-auto font-mono text-xs text-ink-subtle">
                {graph.edges.length} relations · drag to orbit
              </span>
            </div>
          }
        />
      )}
    </AdminShell>,
  );
});
