/**
 * The field-type registry — the code side of the schema engine
 * (steering/SCHEMA_ENGINE.md). Adding a field type = add a module here + register
 * it below + a round-trip test. No other file should need to change.
 */

import { z, type ZodType } from 'zod';
import type { AnyFieldType, FieldDescriptor, JSONSchema } from '@/fields/types';
import { textField } from '@/fields/text';
import { slugField } from '@/fields/slug';
import { markdownField } from '@/fields/markdown';
import { numberField } from '@/fields/number';
import { booleanField } from '@/fields/boolean';
import { datetimeField } from '@/fields/datetime';
import { selectField } from '@/fields/select';
import { tagsField } from '@/fields/tags';
import { jsonField } from '@/fields/json';
import { mediaField } from '@/fields/media';

const REGISTRY: ReadonlyMap<string, AnyFieldType> = new Map(
  [
    textField,
    slugField,
    markdownField,
    numberField,
    booleanField,
    datetimeField,
    selectField,
    tagsField,
    jsonField,
    mediaField,
  ].map((ft) => [ft.key, ft as unknown as AnyFieldType]),
);

export function getFieldType(key: string): AnyFieldType | undefined {
  return REGISTRY.get(key);
}

export function requireFieldType(key: string): AnyFieldType {
  const ft = REGISTRY.get(key);
  if (!ft) throw new Error(`Unknown field type '${key}'`);
  return ft;
}

export function listFieldTypeKeys(): string[] {
  return [...REGISTRY.keys()];
}

/** Whether a field type can be promoted into document_index (has toIndex). */
export function isIndexable(key: string): boolean {
  return typeof REGISTRY.get(key)?.toIndex === 'function';
}

/**
 * Resolve a descriptor to its validated config and value validator. Throws if
 * the type is unknown or the config is invalid (bad definitions never reach the
 * database — SCHEMA_ENGINE.md).
 */
export function resolveField(field: FieldDescriptor): {
  ft: AnyFieldType;
  config: unknown;
  valueSchema: ZodType<unknown>;
} {
  const ft = requireFieldType(field.type);
  const config = ft.configSchema.parse(field.config ?? {});
  const valueSchema = ft.valueSchema(config as never, field) as ZodType<unknown>;
  return { ft, config, valueSchema };
}

/**
 * The machine surface (5 REST/OpenAPI + 6 MCP). Uses the field type's explicit
 * jsonSchema when provided, else derives it from valueSchema via Zod 4.
 */
export function jsonSchemaFor(field: FieldDescriptor): JSONSchema {
  const ft = requireFieldType(field.type);
  const config = ft.configSchema.parse(field.config ?? {});
  if (ft.jsonSchema) return ft.jsonSchema(config as never, field);
  return z.toJSONSchema(ft.valueSchema(config as never, field)) as JSONSchema;
}
