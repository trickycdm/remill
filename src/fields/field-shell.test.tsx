import { describe, it, expect } from 'vitest';
import type { FC } from 'hono/jsx';
import { listFieldTypeKeys, requireFieldType, resolveField } from '@/fields/registry';
import { datetimeLocalToIso, isoToDatetimeLocal } from '@/fields/datetime';
import type { FieldDescriptor } from '@/fields/types';

/**
 * Rendering-level verification of the FieldShell refactor (TD-1) and the
 * config-aware list cell (TD-2). Field EditComponents / CellComponents are Hono
 * JSX FCs; `.toString()` renders them to HTML we can assert on.
 */

function renderEdit(field: FieldDescriptor, value: unknown): string {
  const { ft, config } = resolveField(field);
  const Edit = ft.EditComponent as unknown as FC<{ field: FieldDescriptor; config: unknown; value: unknown; signal: string }>;
  return String((<Edit field={field} config={config} value={value} signal={field.key} />).toString());
}

function renderCell(field: FieldDescriptor, value: unknown): string {
  const { ft, config } = resolveField(field);
  const Cell = ft.CellComponent as unknown as FC<{ value: unknown; config: unknown }>;
  return String((<Cell value={value} config={config} />).toString());
}

/** A valid descriptor per field type for the contract sweep. */
const FIELD_BY_TYPE: Record<string, FieldDescriptor> = {
  text: { key: 'text', type: 'text' },
  slug: { key: 'slug', type: 'slug' },
  markdown: { key: 'markdown', type: 'markdown' },
  number: { key: 'number', type: 'number' },
  boolean: { key: 'boolean', type: 'boolean' },
  datetime: { key: 'datetime', type: 'datetime' },
  select: { key: 'select', type: 'select', config: { options: [{ value: 'a', label: 'A' }] } },
  tags: { key: 'tags', type: 'tags' },
  json: { key: 'json', type: 'json' },
  media: { key: 'media', type: 'media' },
};

describe('FieldShell refactor — every EditComponent keeps its contract wiring', () => {
  it('renders id/name/data-bind + a label into a FormField for all 10 types', () => {
    for (const key of listFieldTypeKeys()) {
      const field = FIELD_BY_TYPE[key];
      expect(field, `missing sample field for type ${key}`).toBeTruthy();
      const html = renderEdit(field, undefined);
      expect(html, `${key}: id`).toContain(`id="${field.key}"`);
      expect(html, `${key}: name`).toContain(`name="${field.key}"`);
      expect(html, `${key}: data-bind`).toContain(`data-bind="${field.key}"`);
      // FormField wires the <label for=…> to the control id.
      expect(html, `${key}: label`).toContain(`for="${field.key}"`);
    }
  });

  it('marks a required field via the FormField required affordance', () => {
    const html = renderEdit({ key: 'title', type: 'text', required: true }, undefined);
    expect(html).toContain('(required)');
    expect(html).toContain('required');
  });

  it('uses field.label as the visible label, falling back to the key', () => {
    expect(renderEdit({ key: 'title', type: 'text', label: 'Headline' }, undefined)).toContain('Headline');
    expect(renderEdit({ key: 'body', type: 'markdown' }, undefined)).toContain('body');
  });
});

describe('media & slug honor field.admin (drift fix, TD-1)', () => {
  it('media: uses admin.placeholder / admin.help when provided', () => {
    const html = renderEdit(
      { key: 'hero', type: 'media', admin: { placeholder: 'pick-one', help: 'Custom media help' } },
      undefined,
    );
    expect(html).toContain('placeholder="pick-one"');
    expect(html).toContain('Custom media help');
  });

  it('media: falls back to its defaults with no admin hints', () => {
    const html = renderEdit({ key: 'hero', type: 'media' }, undefined);
    expect(html).toContain('med_');
    expect(html).toContain('Upload in the Media library');
  });

  it('slug: uses admin.placeholder / admin.help when provided', () => {
    const html = renderEdit(
      { key: 'slug', type: 'slug', admin: { placeholder: 'custom-slug', help: 'Custom slug help' } },
      undefined,
    );
    expect(html).toContain('placeholder="custom-slug"');
    expect(html).toContain('Custom slug help');
  });

  it('slug: falls back to its defaults with no admin hints', () => {
    const html = renderEdit({ key: 'slug', type: 'slug' }, undefined);
    expect(html).toContain('placeholder="my-post-slug"');
    expect(html).toContain('Auto-generated if left blank');
  });
});

describe('select list cell renders the option label, not the raw value (TD-2)', () => {
  const single: FieldDescriptor = {
    key: 'cat',
    type: 'select',
    config: { options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }] },
  };
  const multi: FieldDescriptor = {
    key: 'roles',
    type: 'select',
    config: { options: [{ value: 'x', label: 'Editor' }, { value: 'y', label: 'Viewer' }], multiple: true },
  };

  it('single: shows the human label for the stored value', () => {
    const html = renderCell(single, 'a');
    expect(html).toContain('Apple');
  });

  it('multiple: joins the labels of every stored value', () => {
    expect(renderCell(multi, ['x', 'y'])).toContain('Editor, Viewer');
  });

  it('falls back to the raw value when it is not a known option', () => {
    expect(renderCell(single, 'gone')).toContain('gone');
  });
});

describe('datetime round-trips between the widget and the validator (COR-1)', () => {
  it('datetimeLocalToIso adds missing seconds + Z', () => {
    expect(datetimeLocalToIso('2026-07-04T12:30')).toBe('2026-07-04T12:30:00Z');
    expect(datetimeLocalToIso('2026-07-04T12:30:45')).toBe('2026-07-04T12:30:45Z');
  });

  it('isoToDatetimeLocal strips to the widget shape, keeping non-zero seconds', () => {
    expect(isoToDatetimeLocal('2026-07-04T12:30:00Z')).toBe('2026-07-04T12:30');
    expect(isoToDatetimeLocal('2026-07-04T12:30:00.000Z')).toBe('2026-07-04T12:30');
    expect(isoToDatetimeLocal('2026-07-04T12:30:45Z')).toBe('2026-07-04T12:30:45');
  });

  it('round-trips a stored ISO value through the widget and back', () => {
    const iso = '2026-07-04T09:05:00Z';
    expect(datetimeLocalToIso(isoToDatetimeLocal(iso))).toBe(iso);
  });

  it('the edit widget populates the datetime-local value from a stored ISO string', () => {
    const html = renderEdit({ key: 'publishAt', type: 'datetime' }, '2026-07-04T12:30:00Z');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-07-04T12:30"');
  });

  it('a widget value coerces to an ISO the datetime validator accepts', () => {
    const iso = datetimeLocalToIso('2026-07-04T12:30');
    const ft = requireFieldType('datetime');
    const schema = ft.valueSchema({} as never, { key: 'd', type: 'datetime' });
    expect(schema.safeParse(iso).success).toBe(true);
  });
});
