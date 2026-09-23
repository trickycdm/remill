/**
 * BacklinksPanel — "Referenced by": the reverse edges of the knowledge graph for
 * one document (B3). Read-only; the documents service has already filtered the
 * referrers to what THIS reader may see, so rendering is a plain list. Renders
 * nothing when the document has no referrers. Lives in the editor's main column,
 * below the content form — not a full-width card.
 */

import type { Backlink } from '@/services/documents';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from '@/components/ui';

export function BacklinksPanel({ backlinks }: { backlinks: Backlink[] }) {
  if (!backlinks.length) return null;
  return (
    <Card class="mt-8">
      <CardHeader>
        <CardTitle as="h2">Referenced by</CardTitle>
        <CardDescription>Documents that link to this one through a relation field.</CardDescription>
      </CardHeader>
      <CardContent class="pt-0">
        <ul class="flex flex-col gap-2">
          {backlinks.map((b) => (
            <li class="flex flex-wrap items-center gap-2">
              <a href={`/admin/c/${b.collection}/${b.id}`} class="text-sm font-medium text-accent-text hover:underline">
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
