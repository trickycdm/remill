import { describe, it, expect } from 'vitest';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';

const def = (fields: FieldDescriptor[]): CollectionDefinition => ({
  slug: 'c',
  name: 'C',
  shape: 'collection',
  fields,
});

describe('resolveConventionLayout', () => {
  it('binds title→H1, first media→hero, first non-title text→lead, prose→body; slug omitted', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text', index: true },
        { key: 'slug', type: 'slug', index: true },
        { key: 'cover', type: 'media' },
        { key: 'excerpt', type: 'text' },
        { key: 'body', type: 'markdown' },
        { key: 'tags', type: 'tags', index: true },
      ]),
    );
    expect(layout.titleField?.key).toBe('title');
    expect(layout.hero?.key).toBe('cover');
    expect(layout.lead?.key).toBe('excerpt');
    expect(layout.body.map((f) => f.key)).toEqual(['body']);
    // slug excluded; title/hero/lead/body claimed; only tags remain as meta.
    expect(layout.meta.map((f) => f.key)).toEqual(['tags']);
  });

  it('first media wins as hero; a second media falls through to meta', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text' },
        { key: 'hero', type: 'media' },
        { key: 'gallery', type: 'media' },
      ]),
    );
    expect(layout.hero?.key).toBe('hero');
    expect(layout.meta.map((f) => f.key)).toEqual(['gallery']);
  });

  it('the lead is the first NON-title text field (never the title itself)', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'headline', type: 'text' },
        { key: 'summary', type: 'text' },
      ]),
    );
    expect(layout.titleField?.key).toBe('headline');
    expect(layout.lead?.key).toBe('summary');
  });

  it('slug never appears in any bucket', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text' },
        { key: 'slug', type: 'slug', index: true },
      ]),
    );
    const keys = [
      layout.titleField?.key,
      layout.hero?.key,
      layout.lead?.key,
      ...layout.body.map((f) => f.key),
      ...layout.meta.map((f) => f.key),
    ].filter(Boolean);
    expect(keys).not.toContain('slug');
  });

  it('leftover non-slug fields (json, number) surface in meta — nothing disappears', () => {
    const layout = resolveConventionLayout(
      def([
        { key: 'title', type: 'text' },
        { key: 'meta', type: 'json' },
        { key: 'views', type: 'number', index: true },
      ]),
    );
    expect(layout.meta.map((f) => f.key).sort()).toEqual(['meta', 'views']);
  });
});
