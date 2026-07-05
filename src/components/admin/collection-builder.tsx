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
import { Button, Input, Select, FormField, Plus, Trash } from '@/components/ui';

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
      config: type === 'select' ? { options: parseOptions(body, i) } : undefined,
    });
  }

  return {
    slug: firstString(body.slug).trim(),
    name: firstString(body.name).trim(),
    shape: firstString(body.shape) === 'singleton' ? 'singleton' : 'collection',
    fields,
    workflow: 'workflow_draft_publish' in body ? { draftPublish: true } : undefined,
    access: 'access_public_read' in body ? { publicRead: true } : undefined,
  };
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

/** One field-row slot in the pool. Hidden slots disable their inputs so they
 *  never post; every control carries an aria-label for the row it belongs to. */
function FieldRow({
  i,
  field,
  typeKeys,
  initialCount,
  maxOptions,
}: {
  i: number;
  field: FieldDescriptor | undefined;
  typeKeys: string[];
  initialCount: number;
  maxOptions: number;
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
        <div class="flex items-center gap-3">
          {checkboxes.map((cb) => (
            <label class="flex items-center gap-1.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                name={`field_${i}_${cb.key}`}
                checked={cb.on}
                aria-label={`${cb.label} for field ${n}`}
                data-attr:disabled={hiddenDisabled}
                class="size-4 rounded border-border-strong text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span aria-hidden="true">{cb.label.slice(0, 3)}</span>
            </label>
          ))}
        </div>
      </div>
      <FieldOptionsEditor
        i={i}
        n={n}
        options={options}
        maxOptions={maxOptions}
        initialShown={shown && selectedType === 'select'}
        initialOptCount={Math.max(options.length, 1)}
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
}: {
  def?: CollectionDefinition;
  action: string;
  submitLabel: string;
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
      <div class="grid gap-5 sm:grid-cols-2">
        <FormField fieldId="col-name" label="Name" required>
          <Input id="col-name" name="name" value={def?.name} placeholder="Blog posts" required />
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
            placeholder="posts"
            required={!isEdit}
            disabled={isEdit}
            readonly={isEdit}
          />
          {isEdit ? <input type="hidden" name="slug" value={def?.slug} /> : null}
        </FormField>
      </div>

      <div class="grid gap-5 sm:grid-cols-2">
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

        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium text-ink">Options</legend>
          <label class="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="workflow_draft_publish"
              checked={def?.workflow?.draftPublish}
              class="size-4 rounded border-border-strong text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            Draft / publish workflow
          </label>
          <label class="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="access_public_read"
              checked={def?.access?.publicRead}
              class="size-4 rounded border-border-strong text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            Public read access
          </label>
        </fieldset>
      </div>

      {/* ── Fields ────────────────────────────────────────────────────────────── */}
      <fieldset class="flex flex-col gap-3 border-t border-border pt-6">
        <legend class="font-serif text-lg font-semibold tracking-tight text-ink">Fields</legend>
        <p class="text-sm text-ink-muted">
          Each field defines one column of the document. A field must have a key and a type.
          Indexed fields are queryable and sortable; a unique field must also be indexed.
          A <code class="font-mono">select</code> field lists its choices in the options editor.
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
            <FieldRow i={i} field={existing[i]} typeKeys={typeKeys} initialCount={initialCount} maxOptions={MAX_OPTIONS} />
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
