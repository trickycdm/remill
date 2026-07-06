/**
 * BacklinksPanel — "Referenced by": the reverse edges of the knowledge graph for
 * one document (B3). Read-only; the documents service has already filtered the
 * referrers to what THIS reader may see, so rendering is a plain list. Renders
 * nothing when the document has no referrers.
 */

import type { Backlink } from '@/services/documents';
import { Card, CardContent, Badge } from '@/components/ui';

export function BacklinksPanel({ backlinks }: { backlinks: Backlink[] }) {
  if (!backlinks.length) return null;
  return (
    <Card class="mt-8">
      <CardContent class="pt-6">
        <h2 class="font-serif text-lg font-semibold tracking-tight text-ink">Referenced by</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Documents that link to this one through a relation field.
        </p>
        <ul class="mt-4 flex flex-col gap-2">
          {backlinks.map((b) => (
            <li class="flex flex-wrap items-center gap-2">
              <a href={`/admin/c/${b.collection}/${b.id}`} class="font-medium text-accent-text hover:underline">
                {b.title ?? b.id}
              </a>
              <Badge>{b.collection}</Badge>
              {b.status === 'draft' ? <Badge tone="neutral">draft</Badge> : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
