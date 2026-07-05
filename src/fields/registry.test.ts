import { describe, it, expect } from 'vitest';
import { requireFieldType, resolveField, jsonSchemaFor, isIndexable } from '@/fields/registry';
import type { FieldDescriptor } from '@/fields/types';

/**
 * Round-trips every field type through its surfaces: config → validator → a valid
 * value → toIndex → jsonSchema (SCHEMA_ENGINE.md verification). One case per type,
 * plus the negative that json is non-indexable.
 */
const CASES: Array<{
  type: string;
  field: FieldDescriptor;
  valid: unknown;
  invalid?: unknown;
  expectIndex?: string | number | null;
}> = [
  { type: 'text', field: { key: 'f', type: 'text', required: true }, valid: 'hello', invalid: 123, expectIndex: 'hello' },
  { type: 'slug', field: { key: 'f', type: 'slug' }, valid: 'my-slug', expectIndex: 'my-slug' },
  { type: 'markdown', field: { key: 'f', type: 'markdown' }, valid: '# Title', invalid: 5 },
  { type: 'number', field: { key: 'f', type: 'number', config: { min: 0 } }, valid: 42, invalid: -1, expectIndex: 42 },
  { type: 'boolean', field: { key: 'f', type: 'boolean' }, valid: true, invalid: 'yes', expectIndex: 1 },
  { type: 'datetime', field: { key: 'f', type: 'datetime' }, valid: '2026-07-04T00:00:00Z', invalid: 'not-a-date' },
  {
    type: 'select',
    field: { key: 'f', type: 'select', config: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
    valid: 'a',
    invalid: 'z',
    expectIndex: 'a',
  },
  { type: 'tags', field: { key: 'f', type: 'tags' }, valid: ['x', 'y'], expectIndex: 'x, y' },
  { type: 'json', field: { key: 'f', type: 'json' }, valid: { any: 'thing' } },
];

describe('field-type registry — round-trip every type', () => {
  for (const c of CASES) {
    it(`${c.type}: config → validator → value → index → jsonSchema`, () => {
      const ft = requireFieldType(c.type);
      expect(ft.key).toBe(c.type);

      const { valueSchema } = resolveField(c.field);
      expect(valueSchema.safeParse(c.valid).success).toBe(true);
      if (c.invalid !== undefined) {
        expect(valueSchema.safeParse(c.invalid).success).toBe(false);
      }

      if (c.expectIndex !== undefined) {
        expect(ft.toIndex?.(c.valid as never)).toBe(c.expectIndex);
      }

      const schema = jsonSchemaFor(c.field);
      expect(schema).toBeTruthy();
      expect(typeof schema).toBe('object');
    });
  }

  it('json is not indexable; text/number/etc. are', () => {
    expect(isIndexable('json')).toBe(false);
    expect(isIndexable('text')).toBe(true);
    expect(isIndexable('number')).toBe(true);
    expect(isIndexable('boolean')).toBe(true);
  });

  it('every registered type implements the required contract members', () => {
    for (const c of CASES) {
      const ft = requireFieldType(c.type);
      expect(typeof ft.configSchema.safeParse).toBe('function');
      expect(typeof ft.valueSchema).toBe('function');
      expect(typeof ft.EditComponent).toBe('function');
    }
  });
});
