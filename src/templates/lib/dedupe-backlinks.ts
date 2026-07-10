/**
 * Presentation-layer backlink dedupe: when A's relation field points at B and B
 * points back at A, A's reading page would show B twice — once as a forward
 * relation row ("Related") and again inches lower under "Referenced by". The
 * reverse edge is redundant TO A READER exactly when it duplicates a forward
 * one, so templates filter those; the REST/MCP `backlinks_<slug>` surface keeps
 * returning the whole reverse graph — machine consumers want it complete.
 */

import type { CollectionDefinition } from '@/fields/types';
import type { ExpandedDocument, Backlink } from '@/services/documents';

export function dedupeBacklinks(
  backlinks: Backlink[],
  def: CollectionDefinition,
  doc: ExpandedDocument,
): Backlink[] {
  const forward = new Set<string>();
  for (const f of def.fields) {
    if (f.type !== 'relation') continue;
    const v = doc.data[f.key];
    if (typeof v === 'string') forward.add(v);
    else if (Array.isArray(v)) {
      for (const id of v) if (typeof id === 'string') forward.add(id);
    }
  }
  if (!forward.size) return backlinks;
  return backlinks.filter((b) => !forward.has(b.id));
}
