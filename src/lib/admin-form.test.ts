import { describe, it, expect } from 'vitest';
import { coerceAdminForm } from '@/lib/admin-form';
import { resolveField } from '@/fields/registry';
import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';

/**
 * coerceAdminForm — the admin-surface glue that turns a form POST into the typed
 * shape the documents service validates. Covers the three correctness fixes:
 *   COR-2 blank optional fields are omitted (not sent as '').
 *   COR-1 datetime-local is coerced to full ISO-8601 UTC.
 *   COR-4 multi-select persists as an array (incl. the single-choice edge).
 */

const def: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true },
    { key: 'cat', type: 'select', config: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
    { key: 'roles', type: 'select', config: { options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }], multiple: true } },
    { key: 'hero', type: 'media' },
    { key: 'meta', type: 'json' },
    { key: 'publishAt', type: 'datetime' },
  ],
};

const schemaFor = (key: string) =>
  resolveField(def.fields.find((f) => f.key === key) as FieldDescriptor).valueSchema;

describe('coerceAdminForm — COR-2 blank optional fields are omitted', () => {
  it('drops empty optional select / media / json instead of sending ""', () => {
    const out = coerceAdminForm(def, { title: 'Hi', cat: '', hero: '', meta: '' });
    expect(out.title).toBe('Hi');
    expect('cat' in out).toBe(false);
    expect('hero' in out).toBe(false);
    expect('meta' in out).toBe(false);
  });

  it("proves the fix matters: '' would be rejected but undefined (omitted) passes", () => {
    // An optional select rejects '' (not a valid option) — so it MUST be omitted.
    expect(schemaFor('cat').safeParse('').success).toBe(false);
    expect(schemaFor('cat').safeParse(undefined).success).toBe(true);
    // media id '' fails the id regex; omitted passes.
    expect(schemaFor('hero').safeParse('').success).toBe(false);
    expect(schemaFor('hero').safeParse(undefined).success).toBe(true);
  });

  it('keeps a blank REQUIRED field flowing through so it still errors as required', () => {
    const out = coerceAdminForm(def, { title: '' });
    expect('title' in out).toBe(true);
    expect(out.title).toBe('');
    expect(schemaFor('title').safeParse('').success).toBe(false); // errors as required
  });
});

describe('coerceAdminForm — COR-4 multi-select persists as an array', () => {
  it('keeps every value when several options are chosen (all: true → array)', () => {
    const out = coerceAdminForm(def, { title: 'Hi', roles: ['x', 'y'] });
    expect(out.roles).toEqual(['x', 'y']);
    expect(schemaFor('roles').safeParse(out.roles).success).toBe(true);
  });

  it('wraps a single chosen option in an array (parseBody returns one string)', () => {
    const out = coerceAdminForm(def, { title: 'Hi', roles: 'x' });
    expect(out.roles).toEqual(['x']);
    expect(schemaFor('roles').safeParse(out.roles).success).toBe(true);
  });

  it('omits an empty optional multi-select', () => {
    const out = coerceAdminForm(def, { title: 'Hi', roles: '' });
    expect('roles' in out).toBe(false);
  });

  it('single (non-multiple) select still coerces to a string and validates', () => {
    const out = coerceAdminForm(def, { title: 'Hi', cat: 'b' });
    expect(out.cat).toBe('b');
    expect(schemaFor('cat').safeParse(out.cat).success).toBe(true);
  });
});

describe('coerceAdminForm — COR-1 datetime coercion', () => {
  it('coerces a datetime-local value to full ISO-8601 UTC that the validator accepts', () => {
    const out = coerceAdminForm(def, { title: 'Hi', publishAt: '2026-07-04T12:30' });
    expect(out.publishAt).toBe('2026-07-04T12:30:00Z');
    expect(schemaFor('publishAt').safeParse(out.publishAt).success).toBe(true);
  });

  it('preserves seconds when the widget supplies them', () => {
    const out = coerceAdminForm(def, { title: 'Hi', publishAt: '2026-07-04T12:30:45' });
    expect(out.publishAt).toBe('2026-07-04T12:30:45Z');
    expect(schemaFor('publishAt').safeParse(out.publishAt).success).toBe(true);
  });

  it('omits a blank optional datetime', () => {
    const out = coerceAdminForm(def, { title: 'Hi', publishAt: '' });
    expect('publishAt' in out).toBe(false);
  });
});
