import { describe, it, expect } from 'vitest';
import { requireFieldType, resolveField, jsonSchemaFor, isIndexable, isMultiValued, listFieldTypeKeys } from '@/fields/registry';
import type { CollectionDefinition, FieldDescriptor, JSONSchema, SaveCtx } from '@/fields/types';

/** A minimal SaveCtx for exercising beforeSave transforms directly. */
function saveCtx(field: FieldDescriptor): SaveCtx {
  const collection: CollectionDefinition = {
    slug: 'c',
    name: 'C',
    shape: 'collection',
    fields: [field],
  };
  return { field, collection, data: {}, principalId: 'prn_test', now: '2026-07-04T00:00:00Z', isCreate: true };
}

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
  /** Expected top-level `type` of the derived JSON Schema (surfaces 5 & 6), for the
   *  field types that map to a single JSON type. Omitted for a union schema (`tags`)
   *  or an untyped one (`json`), which the loop still asserts is a truthy object. */
  jsonType?: string;
}> = [
  { type: 'text', field: { key: 'f', type: 'text', required: true }, valid: 'hello', invalid: 123, expectIndex: 'hello', jsonType: 'string' },
  { type: 'slug', field: { key: 'f', type: 'slug' }, valid: 'my-slug', expectIndex: 'my-slug', jsonType: 'string' },
  { type: 'markdown', field: { key: 'f', type: 'markdown' }, valid: '# Title', invalid: 5, jsonType: 'string' },
  { type: 'number', field: { key: 'f', type: 'number', config: { min: 0 } }, valid: 42, invalid: -1, expectIndex: 42, jsonType: 'number' },
  { type: 'boolean', field: { key: 'f', type: 'boolean' }, valid: true, invalid: 'yes', expectIndex: 1, jsonType: 'boolean' },
  { type: 'datetime', field: { key: 'f', type: 'datetime' }, valid: '2026-07-04T00:00:00Z', invalid: 'not-a-date', jsonType: 'string' },
  {
    type: 'select',
    field: { key: 'f', type: 'select', config: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
    valid: 'a',
    invalid: 'z',
    expectIndex: 'a',
    jsonType: 'string',
  },
  { type: 'tags', field: { key: 'f', type: 'tags' }, valid: ['x', 'y'], expectIndex: 'x, y' },
  { type: 'json', field: { key: 'f', type: 'json' }, valid: { any: 'thing' } },
  // media round-trips its id: value validates, toIndex returns the id verbatim, and
  // its derived schema is a bounded string (SEC-4). Previously absent from CASES.
  { type: 'media', field: { key: 'f', type: 'media' }, valid: 'med_abc123', invalid: 123, expectIndex: 'med_abc123', jsonType: 'string' },
  // relation (single): a doc_ id, indexed verbatim; multi behavior has its own suite below.
  {
    type: 'relation',
    field: { key: 'f', type: 'relation', config: { collection: 'authors' } },
    valid: 'doc_abc123',
    invalid: 'med_abc123',
    expectIndex: 'doc_abc123',
    jsonType: 'string',
  },
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
      if (c.jsonType) expect(schema.type).toBe(c.jsonType);
    });
  }

  it('json is not indexable; text/number/etc. are', () => {
    expect(isIndexable('json')).toBe(false);
    expect(isIndexable('text')).toBe(true);
    expect(isIndexable('number')).toBe(true);
    expect(isIndexable('boolean')).toBe(true);
  });

  it('every registered type implements the required contract members', () => {
    // Iterate the registry itself — not the hand-maintained CASES — so a new field
    // type can never be added without this contract check seeing it.
    for (const key of listFieldTypeKeys()) {
      const ft = requireFieldType(key);
      expect(typeof ft.configSchema.safeParse).toBe('function');
      expect(typeof ft.valueSchema).toBe('function');
      expect(typeof ft.EditComponent).toBe('function');
    }
  });

  it('the round-trip CASES cover every registered type (none silently omitted)', () => {
    expect(new Set(CASES.map((c) => c.type))).toEqual(new Set(listFieldTypeKeys()));
  });

  it('jsonSchema composes a correct object schema — type, properties, required', () => {
    // Mirror how the REST/MCP surfaces build a document schema from field
    // descriptors, and assert the composed object's type/properties/required plus a
    // couple of representative field-level schemas.
    const fields: FieldDescriptor[] = [
      { key: 'title', type: 'text', required: true },
      { key: 'views', type: 'number' },
      { key: 'kind', type: 'select', required: true, config: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
    ];
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];
    for (const f of fields) {
      properties[f.key] = jsonSchemaFor(f);
      if (f.required) required.push(f.key);
    }
    const objectSchema: JSONSchema = { type: 'object', properties, required };

    expect(objectSchema.type).toBe('object');
    expect(Object.keys(properties)).toEqual(['title', 'views', 'kind']);
    expect(required).toEqual(['title', 'kind']);
    expect(properties.title.type).toBe('string');
    expect(properties.views.type).toBe('number');
    expect(properties.kind.type).toBe('string');
    expect(properties.kind.enum).toEqual(['a', 'b']);
  });
});

describe('relation — the graph edge field type (B1)', () => {
  const single: FieldDescriptor = { key: 'f', type: 'relation', config: { collection: 'authors' } };
  const multi: FieldDescriptor = {
    key: 'f',
    type: 'relation',
    config: { collection: 'authors', multiple: true },
  };

  it('config requires a target collection slug', () => {
    const ft = requireFieldType('relation');
    expect(ft.configSchema.safeParse({}).success).toBe(false);
    expect(ft.configSchema.safeParse({ collection: 'Bad Slug' }).success).toBe(false);
    expect(ft.configSchema.safeParse({ collection: 'authors', extra: true }).success).toBe(false);
    expect(ft.configSchema.safeParse({ collection: 'authors', multiple: true, titleField: 'name' }).success).toBe(true);
  });

  it('multiple: validates an id array; toIndex returns the array (one row per element)', () => {
    const ft = requireFieldType('relation');
    const { valueSchema } = resolveField(multi);
    expect(valueSchema.safeParse(['doc_a', 'doc_b']).success).toBe(true);
    expect(valueSchema.safeParse(['doc_a', 'nope']).success).toBe(false);
    expect(ft.toIndex?.(['doc_a', 'doc_b'] as never)).toEqual(['doc_a', 'doc_b']);
    expect(ft.toIndex?.([] as never)).toBeNull();
  });

  it('multiple: beforeSave normalizes the comma-string widget shape and dedupes', () => {
    const ft = requireFieldType('relation');
    expect(ft.beforeSave?.('doc_a, doc_b , doc_a' as never, saveCtx(multi))).toEqual(['doc_a', 'doc_b']);
    // The union's string branch bypasses per-element regex — beforeSave re-checks it.
    expect(() => ft.beforeSave?.('doc_a, not-an-id' as never, saveCtx(multi))).toThrow(/document id/);
  });

  it('multiple + required: an empty normalized list is rejected', () => {
    const req: FieldDescriptor = { ...multi, required: true };
    const ft = requireFieldType('relation');
    expect(() => ft.beforeSave?.('' as never, saveCtx(req))).toThrow(/At least one/);
  });

  it('isMultiValued reads the descriptor config (single: no, multiple: yes; scalars: no)', () => {
    expect(isMultiValued(single)).toBe(false);
    expect(isMultiValued(multi)).toBe(true);
    expect(isMultiValued({ key: 'f', type: 'text' })).toBe(false);
    expect(isMultiValued({ key: 'f', type: 'tags' })).toBe(false); // tags joins to ONE row
  });

  it('multiple: explicit jsonSchema is a bounded id-array (surfaces 5 & 6)', () => {
    const schema = jsonSchemaFor(multi);
    expect(schema.type).toBe('array');
    expect((schema.items as Record<string, unknown>).pattern).toContain('doc_');
  });

  it('SEC-4: bounds the id length and the multi list size', () => {
    const { valueSchema } = resolveField(single);
    expect(valueSchema.safeParse(`doc_${'a'.repeat(100)}`).success).toBe(false);
    const { valueSchema: multiSchema } = resolveField(multi);
    expect(multiSchema.safeParse(Array.from({ length: 101 }, (_, i) => `doc_${i}`)).success).toBe(false);
  });
});

describe('SEC-4 — string/json/tags/media fields carry a default upper bound', () => {
  it('text: rejects a value over the default max length when none is configured', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'text' });
    expect(valueSchema.safeParse('x'.repeat(10_000)).success).toBe(true);
    expect(valueSchema.safeParse('x'.repeat(10_001)).success).toBe(false);
  });

  it('text: a configured maxLength stays authoritative', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'text', config: { maxLength: 5 } });
    expect(valueSchema.safeParse('12345').success).toBe(true);
    expect(valueSchema.safeParse('123456').success).toBe(false);
  });

  it('markdown: rejects a value over the (large) default max length', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'markdown' });
    expect(valueSchema.safeParse('x'.repeat(1_000_001)).success).toBe(false);
  });

  it('slug: bounds the raw input length', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'slug' });
    expect(valueSchema.safeParse('a'.repeat(513)).success).toBe(false);
  });

  it('json: rejects a value whose serialized size exceeds the cap', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'json' });
    expect(valueSchema.safeParse({ big: 'x'.repeat(100_001) }).success).toBe(false);
    expect(valueSchema.safeParse({ ok: 'small' }).success).toBe(true);
  });

  it('json: rejects a value nested deeper than the depth cap', () => {
    let deep: unknown = 0;
    for (let i = 0; i < 40; i++) deep = [deep];
    const { valueSchema } = resolveField({ key: 'f', type: 'json' });
    expect(valueSchema.safeParse(deep).success).toBe(false);
  });

  it('json: beforeSave re-checks depth for the admin JSON-string path', () => {
    let deep: unknown = 0;
    for (let i = 0; i < 40; i++) deep = [deep];
    const ft = requireFieldType('json');
    const field: FieldDescriptor = { key: 'f', type: 'json' };
    expect(() => ft.beforeSave?.(JSON.stringify(deep) as never, saveCtx(field))).toThrow();
  });

  it('json: beforeSave throws a clear "Invalid JSON" error on an unparseable string', () => {
    const ft = requireFieldType('json');
    const field: FieldDescriptor = { key: 'f', type: 'json' };
    expect(() => ft.beforeSave?.('{ not: valid json' as never, saveCtx(field))).toThrow(/Invalid JSON/);
  });

  it('tags: rejects more than the default max number of tags', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'tags' });
    expect(valueSchema.safeParse(Array.from({ length: 100 }, (_, i) => `t${i}`)).success).toBe(true);
    expect(valueSchema.safeParse(Array.from({ length: 101 }, (_, i) => `t${i}`)).success).toBe(false);
  });

  it('tags: rejects an individual tag over the per-tag length cap', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'tags' });
    expect(valueSchema.safeParse(['x'.repeat(101)]).success).toBe(false);
  });

  it('tags: beforeSave caps the split comma-string path too', () => {
    const ft = requireFieldType('tags');
    const field: FieldDescriptor = { key: 'f', type: 'tags' };
    const csv = Array.from({ length: 101 }, (_, i) => `t${i}`).join(',');
    expect(() => ft.beforeSave?.(csv as never, saveCtx(field))).toThrow();
  });

  it('media: bounds the id length', () => {
    const { valueSchema } = resolveField({ key: 'f', type: 'media' });
    expect(valueSchema.safeParse('med_abc123').success).toBe(true);
    expect(valueSchema.safeParse(`med_${'a'.repeat(100)}`).success).toBe(false);
  });
});
