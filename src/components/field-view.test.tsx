import { describe, it, expect } from 'vitest';
import { FieldView } from '@/components/field-view';
import type { FieldDescriptor, MediaMeta } from '@/fields/types';

/** Render the read-only view seam to an HTML string (Hono JSX). */
function renderView(
  field: FieldDescriptor,
  value: unknown,
  opts?: { expanded?: never[] | object; media?: MediaMeta; surface?: 'admin' | 'public' },
): string {
  return String(
    (
      <FieldView
        field={field}
        value={value}
        expanded={opts?.expanded as never}
        media={opts?.media}
        surface={opts?.surface ?? 'public'}
      />
    ).toString(),
  );
}

describe('FieldView — the read-only render seam (C1)', () => {
  it('default: types without a ViewComponent render as ESCAPED text', () => {
    const html = renderView({ key: 'f', type: 'text' }, '<b>bold</b> & <script>x</script>');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('markdown: renders sanitized HTML (rich markup in, no raw HTML out)', () => {
    const html = renderView({ key: 'f', type: 'markdown' }, '# Hi\n\n<script>alert(1)</script>');
    expect(html).toContain('<h1>Hi</h1>');
    expect(html).not.toContain('<script>');
  });

  it('html (D25): renders VERBATIM — the sanctioned trusted-HTML exception', () => {
    const html = renderView(
      { key: 'f', type: 'html' },
      '<svg viewBox="0 0 1 1"></svg><script src="/vendor/chart.umd.js"></script>',
    );
    expect(html).toContain('class="rm-html"');
    expect(html).toContain('<svg viewBox="0 0 1 1">');
    expect(html).toContain('<script src="/vendor/chart.umd.js">');
    // …while markdown stays sanitized (the exception is scoped to the html type).
    expect(renderView({ key: 'f', type: 'markdown' }, '<script>x</script>')).not.toContain('<script>');
  });

  it('relation: renders expanded title links, public vs admin URLs', () => {
    const field: FieldDescriptor = { key: 'f', type: 'relation', config: { collection: 'authors' } };
    const expanded = { id: 'doc_a', title: 'Ada', collection: 'authors' };
    expect(renderView(field, 'doc_a', { expanded, surface: 'public' })).toContain('href="/authors/doc_a"');
    expect(renderView(field, 'doc_a', { expanded, surface: 'admin' })).toContain('href="/admin/c/authors/doc_a"');
    expect(renderView(field, 'doc_a', { expanded })).toContain('Ada');
    // Without expansion it still links, titled by the raw id.
    expect(renderView(field, 'doc_a')).toContain('doc_a');
  });

  it('media: renders an <img>, blank alt without expansion, real alt + dims with it', () => {
    const bare = renderView({ key: 'f', type: 'media' }, 'med_x');
    expect(bare).toContain('src="/media/med_x"');
    expect(bare).toContain('alt=""'); // decorative fallback when the record didn't resolve
    const withMeta = renderView({ key: 'f', type: 'media' }, 'med_x', {
      media: { id: 'med_x', alt: 'A hero photo', width: 1200, height: 630 },
    });
    expect(withMeta).toContain('alt="A hero photo"');
    expect(withMeta).toContain('width="1200"');
    expect(withMeta).toContain('height="630"');
  });

  it('select: renders the human label; datetime: a semantic <time>', () => {
    const sel: FieldDescriptor = {
      key: 'f',
      type: 'select',
      config: { options: [{ value: 'a', label: 'Apple' }] },
    };
    expect(renderView(sel, 'a')).toContain('Apple');
    const time = renderView({ key: 'f', type: 'datetime' }, '2026-07-05T12:30:00Z');
    expect(time).toContain('<time datetime="2026-07-05T12:30:00Z">');
    expect(time).toContain('2026-07-05 12:30');
  });
});
