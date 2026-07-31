/**
 * CollectionBuilder — the browser schema builder (Phase 4). One form that
 * composes a `CollectionDefinition`: identity (name/slug/shape), workflow/access
 * toggles, and a repeating list of field rows. Posts form-encoded via Datastar to
 * the route, which parses it back with `parseCollectionForm` and calls the service.
 *
 * ── Dynamic field rows, without a client framework ──────────────────────────────
 * Datastar can't clone DOM subtrees, so we render a FIXED POOL of `MAX_ROWS` slots
 * server-side and reveal them with a single `count` signal:
 *   • row i is shown when `i < $count` (data-show)
 *   • "Add field" → `$count++` (capped at MAX_ROWS); "Remove last" → `$count--` (min 1)
 *   • a hidden row's inputs are `data-attr:disabled` so the browser omits them from
 *     the POST — otherwise a removed pre-filled row would still submit its old value.
 *
 * Inputs use INDEXED names (`field_0_key`, `field_0_type`, …) rather than `name[]`
 * arrays. This is the key robustness choice: a fixed pool means an unchecked
 * checkbox is simply absent, so parallel `name[]` arrays would misalign by index
 * (checkboxes only post when checked). Unique per-row names sidestep alignment
 * entirely — Hono `parseBody()` returns one clean string per key, and
 * "checkbox key present ⇒ true" reads correctly per row.
 *
 * ── Select options editor (TD-10) ───────────────────────────────────────────────
 * A `select` field needs its own option list. The same fixed-pool idiom nests one
 * level deeper: each field row carries a per-row pool of `MAX_OPTIONS` option slots
 * (`field_i_opt_j_value` / `_label`), revealed by a per-row `optc_i` count signal
 * and shown only while that row's type is `select` (`ftype_i` signal, bound to the
 * type dropdown). Option inputs disable themselves when hidden, off-select, or in a
 * removed row, so only live options post. `parseCollectionForm` reads them back.
 */

import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';
import { listFieldTypeKeys, isIndexable } from '@/fields/registry';
import { jsonForScript } from '@/lib/json-for-script';
import { Button, Input, Select, Checkbox, FormField, Plus, Trash } from '@/components/ui';

type RawBody = Record<string, string | File | (string | File)[]>;

interface SelectOption {
  value: string;
  label: string;
}

function firstString(v: string | File | (string | File)[] | undefined): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return firstString(v[0]);
  return typeof v === 'string' ? v : '';
}

/** The configured option list of a `select` field descriptor (empty otherwise). */
function selectOptionsOf(field: FieldDescriptor | undefined): SelectOption[] {
  if (!field || field.type !== 'select') return [];
  const cfg = field.config as { options?: SelectOption[] } | undefined;
  return Array.isArray(cfg?.options) ? cfg.options : [];
}

interface RelationConfigDraft {
  collection?: string;
  multiple?: boolean;
  titleField?: string;
}

/** The configured relation settings of a `relation` field descriptor. */
function relationConfigOf(field: FieldDescriptor | undefined): RelationConfigDraft | undefined {
  if (!field || field.type !== 'relation') return undefined;
  return (field.config as RelationConfigDraft | undefined) ?? undefined;
}

/** Read one field row's posted relation settings. A blank target posts an empty
 *  `collection` and the collection service rejects it — honest feedback, like the
 *  empty select-options case. */
function parseRelationConfig(body: RawBody, i: number): RelationConfigDraft {
  const titleField = firstString(body[`field_${i}_rel_title`]).trim();
  return {
    collection: firstString(body[`field_${i}_rel_collection`]).trim(),
    multiple: `field_${i}_rel_multiple` in body || undefined,
    titleField: titleField || undefined,
  };
}

/** Read one field row's posted option rows into a value+label list, dropping
 *  blank slots and defaulting a missing label to the value. */
function parseOptions(body: RawBody, i: number): SelectOption[] {
  const options: SelectOption[] = [];
  for (let j = 0; `field_${i}_opt_${j}_value` in body; j++) {
    const value = firstString(body[`field_${i}_opt_${j}_value`]).trim();
    if (!value) continue;
    const label = firstString(body[`field_${i}_opt_${j}_label`]).trim() || value;
    options.push({ value, label });
  }
  return options;
}

/**
 * Parse a builder POST body into a CollectionDefinition. Shared by the new + edit
 * routes so the wire format lives in one place. Rows with a blank `key` are
 * dropped (empty pool slots); `required`/`index`/`unique` are true when present.
 *
 * A `select` field's `config.options` is read from its per-row option editor
 * (TD-10). If the admin adds no options the list is empty and the collection
 * service rejects it (the select config requires ≥1 option) — honest feedback,
 * not the old dummy `{ value: 'option' }` seed that produced an unusable field.
 */
export function parseCollectionForm(body: RawBody): CollectionDefinition {
  const fields: FieldDescriptor[] = [];
  for (let i = 0; `field_${i}_key` in body; i++) {
    const key = firstString(body[`field_${i}_key`]).trim();
    if (!key) continue; // empty pool slot — ignore
    const type = firstString(body[`field_${i}_type`]).trim() || 'text';
    const label = firstString(body[`field_${i}_label`]).trim();
    fields.push({
      key,
      type,
      label: label || undefined,
      required: `field_${i}_required` in body || undefined,
      index: `field_${i}_index` in body || undefined,
      unique: `field_${i}_unique` in body || undefined,
      config:
        type === 'select'
          ? { options: parseOptions(body, i) }
          : type === 'relation'
            ? parseRelationConfig(body, i)
            : undefined,
    });
  }

  // Lifecycle select (B4): 'draft' → draft/publish workflow; 'none' → no publish
  // lifecycle (record-like data); 'publish' (default) → born published.
  const lifecycle = firstString(body.workflow_lifecycle);
  // Visibility select (D46): 'public' → publicRead; 'private' → hidden from
  // discovery; 'default' → neither (discoverable, permission-gated content).
  const visibility = firstString(body.access_visibility);
  return {
    slug: firstString(body.slug).trim(),
    name: firstString(body.name).trim(),
    shape: firstString(body.shape) === 'singleton' ? 'singleton' : 'collection',
    fields,
    workflow:
      lifecycle === 'draft'
        ? { draftPublish: true }
        : lifecycle === 'none'
          ? { lifecycle: 'none' }
          : undefined,
    access:
      visibility === 'public'
        ? { publicRead: true }
        : visibility === 'private'
          ? { private: true }
          : undefined,
    renderMode: firstString(body.render_mode) === 'raw' ? 'raw' : undefined,
  };
}

/** The builder's 3-way lifecycle value for an existing definition. */
function lifecycleValueOf(def: CollectionDefinition | undefined): 'draft' | 'publish' | 'none' {
  if (def?.workflow?.lifecycle === 'none') return 'none';
  return def?.workflow?.draftPublish ? 'draft' : 'publish';
}

/** The builder's 3-way visibility value (D46). One select keeps the
 *  contradictory private+publicRead combo unrepresentable in the UI. */
function visibilityValueOf(def: CollectionDefinition | undefined): 'public' | 'default' | 'private' {
  if (def?.access?.private) return 'private';
  return def?.access?.publicRead ? 'public' : 'default';
}

/** The per-row `select` options editor. A fixed pool of `maxOptions` value+label
 *  slots, revealed by `$optc_i` and shown only while the row is a live select. */
function FieldOptionsEditor({
  i,
  n,
  options,
  maxOptions,
  initialShown,
  initialOptCount,
}: {
  i: number;
  n: number;
  options: SelectOption[];
  maxOptions: number;
  initialShown: boolean;
  initialOptCount: number;
}) {
  // Disabled unless this slot is revealed, the row is a select, and the row is shown.
  const slotDisabled = (j: number) =>
    `${j} >= $optc_${i} || $ftype_${i} !== 'select' || ${i} >= $count`;
  return (
    <div
      data-show={`$ftype_${i} === 'select' && ${i} < $count`}
      style={initialShown ? undefined : 'display:none'}
      role="group"
      aria-label={`Options for field ${n}`}
      class="flex flex-col gap-2 rounded-md border border-border/60 bg-canvas/40 p-3"
    >
      <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
        Options
      </span>
      <div class="flex flex-col gap-2">
        {Array.from({ length: maxOptions }, (_, j) => (
          <div
            data-show={`${j} < $optc_${i}`}
            style={j < initialOptCount ? undefined : 'display:none'}
            class="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <Input
              name={`field_${i}_opt_${j}_value`}
              value={options[j]?.value}
              placeholder="value"
              aria-label={`Option ${j + 1} value for field ${n}`}
              data-attr:disabled={slotDisabled(j)}
            />
            <Input
              name={`field_${i}_opt_${j}_label`}
              value={options[j]?.label}
              placeholder="Label"
              aria-label={`Option ${j + 1} label for field ${n}`}
              data-attr:disabled={slotDisabled(j)}
            />
          </div>
        ))}
      </div>
      <div class="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-on:click={`$optc_${i} = Math.min($optc_${i} + 1, ${maxOptions})`}
          data-attr:disabled={`$optc_${i} >= ${maxOptions}`}
        >
          <Plus class="size-4" />
          Add option
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-on:click={`$optc_${i} = Math.max($optc_${i} - 1, 1)`}
          data-attr:disabled={`$optc_${i} <= 1`}
        >
          <Trash class="size-4" />
          Remove option
        </Button>
      </div>
    </div>
  );
}

/** The per-row `relation` settings editor: target collection, optional title
 *  field, and the multiple toggle. Same show/disable idiom as the options editor
 *  (TD-10) — inputs only post while the row is a live relation. */
function FieldRelationEditor({
  i,
  n,
  config,
  collectionSlugs,
  initialShown,
}: {
  i: number;
  n: number;
  config: RelationConfigDraft | undefined;
  collectionSlugs: string[];
  initialShown: boolean;
}) {
  const disabled = `$ftype_${i} !== 'relation' || ${i} >= $count`;
  // Keep a stored target visible even if its collection was since deleted.
  const slugs =
    config?.collection && !collectionSlugs.includes(config.collection)
      ? [...collectionSlugs, config.collection]
      : collectionSlugs;
  return (
    <div
      data-show={`$ftype_${i} === 'relation' && ${i} < $count`}
      style={initialShown ? undefined : 'display:none'}
      role="group"
      aria-label={`Relation settings for field ${n}`}
      class="flex flex-col gap-2 rounded-md border border-border/60 bg-canvas/40 p-3"
    >
      <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
        Relation
      </span>
      <div class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Select
          name={`field_${i}_rel_collection`}
          aria-label={`Target collection for field ${n}`}
          data-attr:disabled={disabled}
        >
          {slugs.map((s) => (
            <option value={s} selected={s === config?.collection}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          name={`field_${i}_rel_title`}
          value={config?.titleField}
          placeholder="Title field (optional)"
          aria-label={`Title field for field ${n}`}
          data-attr:disabled={disabled}
        />
        <label class="flex items-center gap-1.5 text-xs text-ink-muted">
          <Checkbox
            name={`field_${i}_rel_multiple`}
            checked={config?.multiple}
            aria-label={`Allow multiple references for field ${n}`}
            data-attr:disabled={disabled}
          />
          <span aria-hidden="true">Multiple</span>
        </label>
      </div>
    </div>
  );
}

/** One field-row slot in the pool. Hidden slots disable their inputs so they
 *  never post; every control carries an aria-label for the row it belongs to. */
function FieldRow({
  i,
  field,
  typeKeys,
  initialCount,
  maxOptions,
  collectionSlugs,
}: {
  i: number;
  field: FieldDescriptor | undefined;
  typeKeys: string[];
  initialCount: number;
  maxOptions: number;
  collectionSlugs: string[];
}) {
  const shown = i < initialCount;
  const n = i + 1;
  const selectedType = field?.type ?? 'text';
  const hiddenDisabled = `${i} >= $count`; // Datastar: disabled while this row is hidden
  const options = selectOptionsOf(field);
  const checkboxes: { key: 'required' | 'index' | 'unique'; label: string; on?: boolean }[] = [
    { key: 'required', label: 'Required', on: field?.required },
    { key: 'index', label: 'Indexed', on: field?.index },
    { key: 'unique', label: 'Unique', on: field?.unique },
  ];
  return (
    <div
      data-show={`${i} < $count`}
      style={shown ? undefined : 'display:none'}
      class="flex flex-col gap-3 rounded-lg border border-border bg-surface/40 p-3"
    >
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,9rem)_minmax(0,1.2fr)_auto] sm:items-center">
        <Input
          name={`field_${i}_key`}
          value={field?.key}
          placeholder="field_key"
          aria-label={`Key for field ${n}`}
          data-attr:disabled={hiddenDisabled}
        />
        <Select
          name={`field_${i}_type`}
          aria-label={`Type for field ${n}`}
          data-bind={`ftype_${i}`}
          data-attr:disabled={hiddenDisabled}
        >
          {typeKeys.map((k) => (
            <option value={k} selected={k === selectedType}>
              {isIndexable(k) ? k : `${k} (no index)`}
            </option>
          ))}
        </Select>
        <Input
          name={`field_${i}_label`}
          value={field?.label}
          placeholder="Label (optional)"
          aria-label={`Label for field ${n}`}
          data-attr:disabled={hiddenDisabled}
        />
        <fieldset class="flex items-center gap-3">
          <legend class="sr-only">Flags for field {n}</legend>
          {checkboxes.map((cb) => (
            <label class="flex items-center gap-1.5 text-xs text-ink-muted">
              <Checkbox
                name={`field_${i}_${cb.key}`}
                checked={cb.on}
                aria-label={`${cb.label} for field ${n}`}
                data-attr:disabled={hiddenDisabled}
              />
              <span aria-hidden="true">{cb.label.slice(0, 3)}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <FieldOptionsEditor
        i={i}
        n={n}
        options={options}
        maxOptions={maxOptions}
        initialShown={shown && selectedType === 'select'}
        initialOptCount={Math.max(options.length, 1)}
      />
      <FieldRelationEditor
        i={i}
        n={n}
        config={relationConfigOf(field)}
        collectionSlugs={collectionSlugs}
        initialShown={shown && selectedType === 'relation'}
      />
    </div>
  );
}

/**
 * The schema-builder form. `def` prefilled ⇒ edit mode (slug is the key, so it is
 * locked; a protected collection also locks shape — the service rejects changing
 * either, so we carry the real values in hidden inputs and disable the visible
 * controls).
 */
export function CollectionBuilder({
  def,
  action,
  submitLabel,
  collectionSlugs = [],
}: {
  def?: CollectionDefinition;
  action: string;
  submitLabel: string;
  /** Existing collection slugs — the relation editor's target picker. */
  collectionSlugs?: string[];
}) {
  const isEdit = !!def;
  const isProtected = def?.protected ?? false;
  const typeKeys = listFieldTypeKeys();
  const existing = def?.fields ?? [];
  const MAX_ROWS = Math.max(12, existing.length + 4);
  const initialCount = Math.max(existing.length, 1);
  const maxExistingOptions = existing.reduce((m, f) => Math.max(m, selectOptionsOf(f).length), 0);
  const MAX_OPTIONS = Math.max(8, maxExistingOptions + 2);

  // Seed signals: field-row count + per-row type (`ftype_i`, toggles the options
  // editor) and per-row option count (`optc_i`). jsonForScript is the sanctioned
  // way to embed a signals object (DATASTAR_PATTERNS.md) — it also handles the
  // string `ftype` values the old hand-concatenated seed couldn't.
  const signals: Record<string, unknown> = { count: initialCount, busy: false };
  for (let i = 0; i < MAX_ROWS; i++) {
    const f = existing[i];
    signals[`ftype_${i}`] = f?.type ?? 'text';
    signals[`optc_${i}`] = Math.max(selectOptionsOf(f).length, 1);
  }

  return (
    <form
      class="flex flex-col gap-8"
      data-signals={jsonForScript(signals)}
      data-on:submit={`@post('${action}', {contentType: 'form'})`}
    >
      {/* ── Identity ──────────────────────────────────────────────────────────── */}
      <div class="grid items-start gap-5 sm:grid-cols-2">
        <FormField
          fieldId="col-name"
          label="Name"
          required
          description="Shown across the admin, the API, and public pages."
        >
          <Input id="col-name" name="name" value={def?.name} placeholder="Projects" required />
        </FormField>
        <FormField
          fieldId="col-slug"
          label="Slug"
          required
          description={isEdit ? 'The slug is the collection key and cannot be changed.' : 'Lowercase, starts with a letter (a-z0-9-).'}
        >
          <Input
            id="col-slug"
            name="slug"
            value={def?.slug}
            placeholder="projects"
            required={!isEdit}
            disabled={isEdit}
            readonly={isEdit}
          />
          {isEdit ? <input type="hidden" name="slug" value={def?.slug} /> : null}
        </FormField>
      </div>

      {/* ── Behaviour ─────────────────────────────────────────────────────────── */}
      <fieldset class="flex flex-col gap-4 border-t border-border pt-6">
        <legend class="float-left w-full font-display text-lg font-semibold tracking-tight text-ink">
          Behaviour
        </legend>
        <div class="grid items-start gap-5 sm:grid-cols-2">
          <FormField
            fieldId="col-shape"
            label="Shape"
            description={isProtected ? 'A protected collection cannot change its shape.' : 'A collection has many documents; a singleton has exactly one.'}
          >
            <Select id="col-shape" name="shape" disabled={isProtected}>
              <option value="collection" selected={def?.shape !== 'singleton'}>
                collection
              </option>
              <option value="singleton" selected={def?.shape === 'singleton'}>
                singleton
              </option>
            </Select>
            {isProtected ? <input type="hidden" name="shape" value={def?.shape} /> : null}
          </FormField>
          <FormField
            fieldId="col-lifecycle"
            label="Lifecycle"
            description="Draft & publish for authored content; none for record-like data."
          >
            <Select id="col-lifecycle" name="workflow_lifecycle">
              <option value="publish" selected={lifecycleValueOf(def) === 'publish'}>
                Publish immediately
              </option>
              <option value="draft" selected={lifecycleValueOf(def) === 'draft'}>
                Draft &amp; publish workflow
              </option>
              <option value="none" selected={lifecycleValueOf(def) === 'none'}>
                None (records)
              </option>
            </Select>
          </FormField>
          <FormField
            fieldId="col-render-mode"
            label="Public rendering"
            description="Branded page renders inside the site shell; raw HTML serves the first html field as a standalone document."
          >
            <Select id="col-render-mode" name="render_mode">
              <option value="shell" selected={def?.renderMode !== 'raw'}>
                Branded page (shell)
              </option>
              <option value="raw" selected={def?.renderMode === 'raw'}>
                Raw HTML page
              </option>
            </Select>
          </FormField>
          <FormField
            fieldId="col-visibility"
            label="Visibility"
            description="Public: anyone can read published documents. Discoverable: listed in the API, content needs permission. Private: hidden entirely from anyone without access."
          >
            <Select id="col-visibility" name="access_visibility">
              <option value="default" selected={visibilityValueOf(def) === 'default'}>
                Discoverable
              </option>
              <option value="public" selected={visibilityValueOf(def) === 'public'}>
                Public
              </option>
              <option value="private" selected={visibilityValueOf(def) === 'private'}>
                Private
              </option>
            </Select>
          </FormField>
        </div>
      </fieldset>

      {/* ── Fields ────────────────────────────────────────────────────────────── */}
      <fieldset class="flex flex-col gap-3 border-t border-border pt-6">
        <legend class="float-left w-full font-display text-lg font-semibold tracking-tight text-ink">
          Fields
        </legend>
        <p class="text-sm text-ink-muted">
          Each field defines one column of the document. A field must have a key and a type.
          Indexed fields are queryable and sortable; a unique field must also be indexed.
          A <code class="font-mono">select</code> field lists its choices in the options editor;
          a <code class="font-mono">relation</code> field picks its target collection in the
          relation editor (index it to make the link filterable and backlinkable).
        </p>

        {/* Column headings (sighted, wide screens); each control keeps its own aria-label. */}
        <div class="hidden gap-3 px-3 sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,9rem)_minmax(0,1.2fr)_auto]">
          <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">Key</span>
          <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">Type</span>
          <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">Label</span>
          <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">Options</span>
        </div>

        <div class="flex flex-col gap-3">
          {Array.from({ length: MAX_ROWS }, (_, i) => (
            <FieldRow
              i={i}
              field={existing[i]}
              typeKeys={typeKeys}
              initialCount={initialCount}
              maxOptions={MAX_OPTIONS}
              collectionSlugs={collectionSlugs}
            />
          ))}
        </div>

        <div class="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-on:click={`$count = Math.min($count + 1, ${MAX_ROWS})`}
            data-attr:disabled={`$count >= ${MAX_ROWS}`}
          >
            <Plus class="size-4" />
            Add field
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-on:click="$count = Math.max($count - 1, 1)"
            data-attr:disabled="$count <= 1"
          >
            <Trash class="size-4" />
            Remove last field
          </Button>
        </div>
      </fieldset>

      {/* Morph target for the inline save-error fragment (200, #form-result). */}
      <div id="form-result" />

      <div class="flex items-center gap-3 border-t border-border pt-6">
        <Button type="submit" busy="$busy">
          {submitLabel}
        </Button>
        <a href="/admin/collections" class="text-sm text-ink-muted hover:text-ink hover:underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
