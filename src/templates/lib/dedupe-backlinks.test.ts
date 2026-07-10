import { describe, it, expect } from 'vitest';
import { dedupeBacklinks } from '@/templates/lib/dedupe-backlinks';
import type { CollectionDefinition } from '@/fields/types';
import type { ExpandedDocument, Backlink } from '@/services/documents';

const DEF: CollectionDefinition = {
  slug: 'docs',
  name: 'Docs',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true },
    { key: 'parent', type: 'relation', config: { collection: 'docs' } },
    { key: 'related', type: 'relation', config: { collection: 'docs', multiple: true } },
  ],
};

function docWith(data: Record<string, unknown>): ExpandedDocument {
  return { id: 'doc_self', collection: 'docs', data } as unknown as ExpandedDocument;
}

const bl = (id: string): Backlink =>
  ({ id, collection: 'docs', title: id, status: 'published', updatedAt: 'x' }) as Backlink;

describe('dedupeBacklinks', () => {
  it('drops reverse edges that duplicate a forward relation (scalar AND array fields)', () => {
    const doc = docWith({ title: 'T', parent: 'doc_a', related: ['doc_b', 'doc_c'] });
    const out = dedupeBacklinks([bl('doc_a'), bl('doc_b'), bl('doc_d')], DEF, doc);
    expect(out.map((b) => b.id)).toEqual(['doc_d']);
  });

  it('passes everything through when the doc has no forward relations', () => {
    const doc = docWith({ title: 'T' });
    const links = [bl('doc_a'), bl('doc_b')];
    expect(dedupeBacklinks(links, DEF, doc)).toBe(links); // same array — no copy
  });
});
