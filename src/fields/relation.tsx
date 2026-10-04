/**
 * `relation` — references document(s) in a target collection by `doc_…` id: the
 * edges of the knowledge graph. Stored as the id (or id array when `multiple`);
 * indexed one document_index row per referenced id, so every edge is
 * independently filterable and reverse-lookupable (backlinks). Validation is
 * FORMAT-ONLY, mirroring `media` — target existence is resolved on read
 * (expansion), not on save, so a dangling reference degrades gracefully.
 */

import { z } from 'zod';
import { Badge, Input, Search, X, INPUT_BASE, CONTROL_H, cx } from '@/components/ui';
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

/** One linked document: its title (the raw id when it could not be resolved)
 *  linking to its editor, plus a remove control the picker island reveals. */
function RelationChip({ id, title, collection }: { id: string; title: string | null; collection: string }) {
  return (
    <li
      data-id={id}
      class="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface py-1 pr-1 pl-2.5 text-sm"
    >
      <a
        data-relation-title
        href={`/admin/c/${collection}/${id}`}
        target="_blank"
        rel="noopener"
        class={cx(
          'truncate rounded-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          title === null && 'font-mono text-xs',
        )}
      >
        {title ?? id}
      </a>
      <button
        type="button"
        data-relation-remove
        aria-label={`Remove ${title ?? id}`}
        class="hidden size-6 shrink-0 items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <X class="size-3.5" />
      </button>
    </li>
  );
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
  // Chips + a title search (the relation-picker island, src/client/). The text
  // input stays in the DOM as the form-value carrier (DATASTAR_PATTERNS §g), so
  // with no JS this is still a working id field — now with the titles shown.
  EditComponent: ({ field, config, value, signal, expanded }) => {
    const multiple = config.multiple === true;
    const ids = Array.isArray(value) ? value : value ? [value] : [];
    const titles = new Map(
      (expanded ? (Array.isArray(expanded) ? expanded : [expanded]) : []).map((r) => [r.id, r.title]),
    );
    return (
      <FieldShell field={field} signal={signal} help={`Links to documents in '${config.collection}'.`}>
        <div
          class="relative flex flex-col gap-2"
          data-relation-picker
          data-collection={config.collection}
          data-multiple={multiple ? 'true' : undefined}
        >
          <ul data-relation-chips class="flex flex-wrap gap-2 empty:hidden">
            {ids.map((id) => (
              <RelationChip id={id} title={titles.get(id) ?? null} collection={config.collection} />
            ))}
          </ul>
          {/* The island clones this for every pick, so chip markup lives in one place. */}
          <template data-relation-chip-template>
            <RelationChip id="" title={null} collection={config.collection} />
          </template>
          <Input
            {...controlProps({ field, signal }, { placeholder: multiple ? 'doc_…, doc_…' : 'doc_…', required: false })}
            type="text"
            value={ids.join(', ')}
          />
          {/* Hidden until the island mounts and takes over from the id input. */}
          <div class="relative hidden" data-relation-search>
            <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
            <input
              id={`${signal}-search`}
              type="text"
              role="combobox"
              autocomplete="off"
              aria-autocomplete="list"
              aria-expanded="false"
              aria-controls={`${signal}-results`}
              placeholder={`Search ${config.collection} by title…`}
              class={cx(INPUT_BASE, CONTROL_H.md, 'border-border-strong pl-9 focus-visible:outline-ring')}
            />
            <div
              id={`${signal}-results`}
              data-relation-results
              class="absolute inset-x-0 top-full z-30 mt-1 hidden max-h-72 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 shadow-lg"
            />
          </div>
          <span data-relation-status role="status" aria-live="polite" class="sr-only" />
          <a
            href={`/admin/c/${config.collection}`}
            target="_blank"
            rel="noopener"
            class="self-start rounded-sm text-[13px] text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
  // Detail/public render: resolved title links — public URLs on the public
  // surface (the public route resolves ids as well as slugs), admin URLs inside.
  ViewComponent: ({ config, value, expanded, surface }) => {
    const refs = expanded
      ? Array.isArray(expanded)
        ? expanded
        : [expanded]
      : (Array.isArray(value) ? value : value ? [value] : []).map((id) => ({
          id: String(id),
          title: null,
          collection: config.collection,
        }));
    if (!refs.length) return null;
    const href = (r: { collection: string; id: string }) =>
      surface === 'public' ? `/${r.collection}/${r.id}` : `/admin/c/${r.collection}/${r.id}`;
    return (
      <span class="flex flex-wrap gap-x-2 gap-y-1">
        {refs.map((r) => (
          <a href={href(r)} class="text-accent-text hover:underline">
            {r.title ?? r.id}
          </a>
        ))}
      </span>
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
