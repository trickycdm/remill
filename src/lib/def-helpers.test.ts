import { describe, it, expect } from 'vitest';
import { titleFieldOf, titleOf } from '@/lib/def-helpers';
import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';

const def = (
  fields: FieldDescriptor[],
  extra?: Partial<CollectionDefinition>,
): CollectionDefinition => ({
  slug: 'c',
  name: 'C',
  shape: 'collection',
  fields,
  ...extra,
});

describe('titleFieldOf — the one shared title heuristic (H1, OG/feeds, search, relations)', () => {
  it('prefers the first TEXT field over an earlier slug field', () => {
    // A slug-first collection must never render its slug as the display title.
    const d = def([
      { key: 'slug', type: 'slug', index: true },
      { key: 'name', type: 'text' },
    ]);
    expect(titleFieldOf(d)).toBe('name');
    expect(titleOf(d, { id: 'doc_x', data: { slug: 'a-slug', name: 'A Name' } })).toBe('A Name');
  });

  it('falls back to a slug field only when no text field exists at all', () => {
    const d = def([
      { key: 'slug', type: 'slug', index: true },
      { key: 'body', type: 'markdown' },
    ]);
    expect(titleFieldOf(d)).toBe('slug');
  });

  it('honors bind.title above convention', () => {
    const d = def(
      [
        { key: 'kicker', type: 'text' },
        { key: 'headline', type: 'text' },
      ],
      { bind: { title: 'headline' } },
    );
    expect(titleFieldOf(d)).toBe('headline');
  });

  it('an explicit configured key wins over bind and convention; unknown keys are ignored', () => {
    const d = def(
      [
        { key: 'kicker', type: 'text' },
        { key: 'headline', type: 'text' },
      ],
      { bind: { title: 'headline' } },
    );
    expect(titleFieldOf(d, 'kicker')).toBe('kicker');
    expect(titleFieldOf(d, 'nope')).toBe('headline'); // falls through to bind
  });
});
