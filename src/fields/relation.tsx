/**
 * `relation` — references document(s) in a target collection by `doc_…` id: the
 * edges of the knowledge graph. Stored as the id (or id array when `multiple`);
 * indexed one document_index row per referenced id, so every edge is
 * independently filterable and reverse-lookupable (backlinks). Validation is
 * FORMAT-ONLY, mirroring `media` — target existence is resolved on read
 * (expansion), not on save, so a dangling reference degrades gracefully.
 */

import { z } from 'zod';
import { Badge, Input } from '@/components/ui';
import { FieldShell, controlProps } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

/** Bound the id list and each id's length (SEC-4). */
const RELATION_MAX = 100;
const ID_MAX_LENGTH = 64;
const DOC_ID_RE = /^doc_[A-Za-z0-9_-]+$/;

const configSchema = z
  .object({
    /** Target collection slug (existence is not validated — media precedent). */
    collection: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/, 'Must be a collection slug'),
    /** Many references instead of one; indexes one row per id. */
    multiple: z.boolean().optional(),
    /** Field key on the TARGET collection to display as the reference's title
     *  (read-expansion, B2). Defaults to the target's first text/slug field. */
    titleField: z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, 'Must be a field key')
      .optional(),
  })
  .strict();

type RelationConfig = z.infer<typeof configSchema>;

function idSchema() {
  return z.string().max(ID_MAX_LENGTH).regex(DOC_ID_RE, 'Must be a document id (doc_…)');
}

function valueSchema(cfg: RelationConfig, field: FieldDescriptor) {
  if (cfg.multiple) {
    const arr = z.array(idSchema()).max(RELATION_MAX);
    // Accept the raw comma-string too (the plain edit widget posts one); beforeSave
    // normalizes it into an id[] and re-validates each element (tags precedent).
    const u = z.union([field.required ? arr.min(1) : arr, z.string()]);
    return field.required ? u : u.optional();
  }
  const id = idSchema();
  return field.required ? id : id.optional();
}

/** Split a comma string into trimmed, non-empty entries. */
function splitIds(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const relationField: FieldType<RelationConfig, string | string[]> = {
  key: 'relation',
  configSchema,
  valueSchema,
  toIndex: (v) => (Array.isArray(v) ? (v.length ? v : null) : (v ?? null)),
  multiValued: (cfg) => cfg.multiple === true,
  references: (cfg) => ({ collection: cfg.collection, titleField: cfg.titleField }),
  beforeSave: (value, ctx) => {
    const cfg = (ctx.field.config ?? {}) as RelationConfig;
    if (!cfg.multiple) return value;
    const v = value as unknown as string[] | string | undefined;
    if (v === undefined) return value;
    // Normalize the comma-string widget shape; the union's string branch bypasses
    // per-element validation, so every id is (re)checked here either way.
    const ids = typeof v === 'string' ? splitIds(v) : v;
    const bad = ids.find((id) => id.length > ID_MAX_LENGTH || !DOC_ID_RE.test(id));
    if (bad !== undefined) throw new Error(`'${bad}' is not a document id (doc_…).`);
    const deduped = [...new Set(ids)];
    if (deduped.length > RELATION_MAX) {
      throw new Error(`Too many references for '${ctx.field.key}' (max ${RELATION_MAX}).`);
    }
    if (ctx.field.required && deduped.length === 0) {
      throw new Error(`At least one reference is required for '${ctx.field.key}'.`);
    }
    return deduped;
  },
  EditComponent: ({ field, config, value, signal }) => {
    const multiple = config.multiple === true;
    const display = Array.isArray(value) ? value.join(', ') : (value ?? '');
    return (
      <FieldShell
        field={field}
        signal={signal}
        help={
          multiple
            ? `Comma-separated document ids from '${config.collection}'.`
            : `A document id from '${config.collection}'.`
        }
      >
        <div class="flex items-center gap-3">
          <Input
            {...controlProps({ field, signal }, { placeholder: multiple ? 'doc_…, doc_…' : 'doc_…', required: false })}
            type="text"
            value={display}
          />
          <a
            href={`/admin/c/${config.collection}`}
            target="_blank"
            rel="noopener"
            class="whitespace-nowrap text-sm text-accent-text hover:underline"
          >
            Browse {config.collection} ↗
          </a>
        </div>
      </FieldShell>
    );
  },
  CellComponent: ({ value, expanded }) => {
    // With read-expansion available (B2), render resolved title links.
    const refs = expanded ? (Array.isArray(expanded) ? expanded : [expanded]) : undefined;
    if (refs?.length) {
      return (
        <span class="flex flex-wrap gap-x-2 gap-y-1">
          {refs.map((r) => (
            <a href={`/admin/c/${r.collection}/${r.id}`} class="text-accent-text hover:underline">
              {r.title ?? r.id}
            </a>
          ))}
        </span>
      );
    }
    if (Array.isArray(value)) {
      return value.length ? (
        <Badge>{value.length} linked</Badge>
      ) : (
        <span class="text-ink-subtle">—</span>
      );
    }
    return value ? (
      <code class="font-mono text-xs">{value}</code>
    ) : (
      <span class="text-ink-subtle">—</span>
    );
  },
  // Explicit machine schema (surfaces 5/6): a clean id-string (or id-array) shape
  // rather than the derived union the comma-string edit affordance would produce.
  jsonSchema: (cfg) => {
    const id = {
      type: 'string',
      pattern: DOC_ID_RE.source,
      maxLength: ID_MAX_LENGTH,
    };
    return cfg.multiple
      ? {
          type: 'array',
          items: id,
          maxItems: RELATION_MAX,
          description: `References (document ids) to documents in '${cfg.collection}'`,
        }
      : { ...id, description: `Reference (document id) to a document in '${cfg.collection}'` };
  },
};
