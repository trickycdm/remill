/**
 * GET /admin/graph — the Nebulae relation-graph explorer (D45). Every readable
 * item is a star; collections cluster as tilted galactic disks; cross-
 * collection relations arc between them. Rendered by the canvas island
 * (src/client/graph.ts) inside an rm-dark-act subtree — the graph is the
 * product's dark act in both admin themes.
 *
 * The route calls ONE service (graphData — routes never touch D1), embeds the
 * compacted payload via jsonForScript (the only sanctioned server→island JSON
 * path), and renders the accessible baseline: a canvas with a real accessible
 * name plus a visually-hidden per-collection summary (deliberately NOT a link
 * per node — 1,500 focusables is a keyboard trap; the full data lives at
 * /admin/c). The island progressively enhances; no JS ⇒ the summary stands.
 */

import { createFactory } from 'hono/factory';
import { Script } from 'vite-ssr-components/hono';
import type { Env } from '@/types';
import { requireAuth, getUser } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { nowIso } from '@/lib/now';
import { graphData } from '@/services/documents';
import { jsonForScript } from '@/lib/json-for-script';
import { AdminShell } from '@/components/layouts/admin-shell';
import { PageHeader, EmptyState, Stamp, Waypoints } from '@/components/ui';

const factory = createFactory<{ Bindings: Env }>();

export const onRequestGet = factory.createHandlers(requireAuth(), async (c) => {
  const user = getUser(c);
  const graph = await graphData(getDb(c.env.DB), requirePrincipal(c), nowIso());

  // Compact wire form: edges as [srcIdx, tgtIdx] index pairs into `nodes` —
  // ~1/3 the bytes of id pairs at full cap. fieldKey/collection of an edge
  // stay server-side (the v1 UI doesn't render them).
  const idx = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const payload = {
    nodes: graph.nodes,
    links: graph.edges.map((e) => [idx.get(e.source)!, idx.get(e.target)!]),
    collections: graph.collections,
    truncated: graph.truncated,
  };

  const countByCollection = new Map<string, number>();
  for (const n of graph.nodes) {
    countByCollection.set(n.collection, (countByCollection.get(n.collection) ?? 0) + 1);
  }
  const ariaLabel =
    `Relation graph: ${graph.nodes.length} items across ` +
    `${graph.collections.length} collections, ${graph.edges.length} relations. ` +
    'Drag to orbit, hover a star to see its connections, click to open the item.';

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
        <div
          data-graph
          class="rm-dark-act overflow-hidden rounded-xl border border-border bg-canvas"
        >
          <canvas
            id="rm-graph-canvas"
            role="img"
            aria-label={ariaLabel}
            class="block h-[70vh] min-h-[420px] w-full cursor-grab touch-none"
          ></canvas>
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
        </div>
      )}

      {/* Accessible equivalent: the per-collection shape of the graph, without
          a focus trap of per-node links. */}
      <section class="sr-only" aria-label="Graph summary">
        <p>
          {graph.nodes.length} items and {graph.edges.length} relations across{' '}
          {graph.collections.length} collections.
          {graph.truncated ? ' The view is truncated to the first slice.' : ''}
        </p>
        <ul>
          {graph.collections.map((col) => (
            <li>
              <a href={`/admin/c/${col.slug}`}>
                {col.name}: {countByCollection.get(col.slug) ?? 0} items
              </a>
            </li>
          ))}
        </ul>
      </section>

      <script
        type="application/json"
        id="rm-graph-data"
        dangerouslySetInnerHTML={{ __html: jsonForScript(payload) }}
      ></script>
      <Script src="/src/client/graph.ts" />
    </AdminShell>,
  );
});
