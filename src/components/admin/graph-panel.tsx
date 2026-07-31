/**
 * GraphPanel — the shared Nebulae embed (D45). Owns the island wire format:
 * the GraphData result compacted with edges as [srcIdx, tgtIdx] index pairs
 * (~1/3 the bytes of id pairs at full cap; an edge's fieldKey/collection stay
 * server-side — the v1 UI doesn't render them), embedded via jsonForScript
 * (the only sanctioned server→island JSON path), plus the [data-graph]
 * wrapper + canvas the island (src/client/graph.ts) mounts on and the
 * visually-hidden per-collection summary that stands when JS is off
 * (deliberately NOT a link per node — 1,500 focusables is a keyboard trap).
 *
 * Both the full explorer (/admin/graph) and the dashboard hero (/admin)
 * render through this so the wire format lives in ONE place. At most one per
 * page — the payload script id is global.
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { Script } from 'vite-ssr-components/hono';
import type { GraphData } from '@/services/documents';
import { jsonForScript } from '@/lib/json-for-script';
import { cx } from '@/components/ui/cx';

/** Node count per collection — the legend chips and the sr summary. */
export function graphCountsByCollection(graph: GraphData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    counts.set(n.collection, (counts.get(n.collection) ?? 0) + 1);
  }
  return counts;
}

export function GraphPanel({
  graph,
  heightClass = 'h-[70vh] min-h-[420px]',
  footer,
}: {
  graph: GraphData;
  /** Tailwind height utilities for the canvas (the dashboard embed is shorter). */
  heightClass?: string;
  /** Rendered inside the [data-graph] wrapper, under the canvas — legend chips
   *  ([data-graph-toggle] buttons wire up automatically) or a summary bar. */
  footer?: JSX.Element;
}): JSX.Element {
  const idx = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const payload = {
    nodes: graph.nodes,
    links: graph.edges.map((e) => [idx.get(e.source)!, idx.get(e.target)!]),
    collections: graph.collections,
    truncated: graph.truncated,
  };
  const counts = graphCountsByCollection(graph);
  const ariaLabel =
    `Relation graph: ${graph.nodes.length} items across ` +
    `${graph.collections.length} collections, ${graph.edges.length} relations. ` +
    'Drag to orbit, hover a star to see its connections, click to open the item.';

  return (
    <>
      <div
        data-graph
        class="rm-dark-act overflow-hidden rounded-xl border border-border bg-canvas"
      >
        <canvas
          id="rm-graph-canvas"
          role="img"
          aria-label={ariaLabel}
          class={cx('block w-full cursor-grab touch-none', heightClass)}
        ></canvas>
        {footer}
      </div>

      {/* Accessible equivalent: the per-collection shape of the graph. */}
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
                {col.name}: {counts.get(col.slug) ?? 0} items
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
    </>
  );
}
