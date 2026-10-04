import { describe, it, expect } from 'vitest';
import type { FC } from 'hono/jsx';
import { resolveField } from '@/fields/registry';
import type { ExpandedReference, FieldDescriptor } from '@/fields/types';
import { VisibilityStamp } from '@/components/admin/visibility-stamp';

/** The relation edit widget, server-rendered: titled chips + the id carrier the
 *  relation-picker island enhances. */
function renderEdit(field: FieldDescriptor, value: unknown, expanded?: ExpandedReference | ExpandedReference[]): string {
  const { ft, config } = resolveField(field);
  const Edit = ft.EditComponent as unknown as FC<{
    field: FieldDescriptor;
    config: unknown;
    value: unknown;
    signal: string;
    expanded?: unknown;
  }>;
  return String((<Edit field={field} config={config} value={value} signal={field.key} expanded={expanded} />).toString());
}

const MANY: FieldDescriptor = { key: 'related', type: 'relation', config: { collection: 'articles', multiple: true } };
const ONE: FieldDescriptor = { key: 'employer', type: 'relation', config: { collection: 'companies' } };

describe('relation EditComponent — chips over the id carrier', () => {
  it('shows each linked document by TITLE, linking to its editor', () => {
    const html = renderEdit(MANY, ['doc_a', 'doc_b'], [
      { id: 'doc_a', title: 'First piece', collection: 'articles' },
      { id: 'doc_b', title: 'Second piece', collection: 'articles' },
    ]);
    expect(html).toContain('First piece');
    expect(html).toContain('Second piece');
    expect(html).toContain('href="/admin/c/articles/doc_a"');
    expect(html).toContain('aria-label="Remove Second piece"');
  });

  it('keeps the ids in the carrier input, comma-joined, so a no-JS save round-trips', () => {
    const html = renderEdit(MANY, ['doc_a', 'doc_b']);
    expect(html).toMatch(/<input[^>]*name="related"[^>]*value="doc_a, doc_b"|<input[^>]*value="doc_a, doc_b"[^>]*name="related"/);
  });

  it('falls back to the raw id when a link could not be resolved (dangling or unreadable)', () => {
    const html = renderEdit(ONE, 'doc_gone', { id: 'doc_gone', title: null, collection: 'companies' });
    expect(html).toContain('>doc_gone<');
    expect(html).toContain('aria-label="Remove doc_gone"');
  });

  it('carries what the island needs: collection, multiplicity, a chip template, a labelled-by-search combobox', () => {
    const many = renderEdit(MANY, undefined);
    expect(many).toContain('data-collection="articles"');
    expect(many).toContain('data-multiple="true"');
    expect(many).toContain('data-relation-chip-template');
    expect(many).toContain('role="combobox"');
    expect(many).toContain('id="related-search"');
    expect(renderEdit(ONE, undefined)).not.toContain('data-multiple');
  });
});

describe('VisibilityStamp — one marker for a non-public document', () => {
  const render = (node: unknown): string => String((node as { toString(): string } | null)?.toString() ?? '');

  it('renders nothing for public (the unmarked default) or a missing value', () => {
    expect(render(<VisibilityStamp visibility="public" />)).toBe('');
    expect(render(<VisibilityStamp visibility={undefined} />)).toBe('');
  });

  it('stamps private and unlisted in the pop ink, as the list view does', () => {
    for (const v of ['private', 'unlisted'] as const) {
      const html = render(<VisibilityStamp visibility={v} />);
      expect(html).toContain(v);
      expect(html).toContain('border-pop-text');
    }
  });
});
