/**
 * Generated admin surfaces — the visible payoff of the schema engine: a
 * collection definition renders its own list view (3) and edit form (4) by
 * composing each field type's CellComponent / EditComponent
 * (steering/SCHEMA_ENGINE.md). No per-collection UI code.
 */

import type { FC } from 'hono/jsx';
import { resolveField } from '@/fields/registry';
import { fieldLabel } from '@/lib/humanize';
import type { CollectionDefinition, FieldDescriptor, ExpandedReference } from '@/fields/types';
import type { DocumentRecord, ExpandedDocument } from '@/services/documents';
import type { SiteSettings } from '@/services/settings';
import { formatDate } from '@/lib/format-date';
import { hasLifecycle } from '@/lib/lifecycle';
import { titleOf } from '@/lib/def-helpers';
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, Button, Badge, Checkbox, EmptyState, Stamp } from '@/components/ui';

type EditProps = { field: FieldDescriptor; config: unknown; value: unknown; signal: string };

/** Render one field's edit widget with its resolved config + current value. */
export function FieldEditor({ field, value }: { field: FieldDescriptor; value: unknown }) {
  const { ft, config } = resolveField(field);
  const Edit = ft.EditComponent as unknown as FC<EditProps>;
  // Field keys are already lowercase snake_case, so they are safe Datastar signal
  // keys (HTML lowercases attribute keys — DATASTAR_PATTERNS.md).
  return <Edit field={field} config={config} value={value} signal={field.key} />;
}

/** Render one list cell using the field type's CellComponent (or a text fallback).
 *  Resolves the field's config (via resolveField) so cells can render human labels
 *  (e.g. select's option label) rather than the raw stored value (TD-2). Passes the
 *  read path's relation expansion through when the row carries one (B2). */
function FieldCell({
  field,
  value,
  expanded,
}: {
  field: FieldDescriptor;
  value: unknown;
  expanded?: ExpandedReference | ExpandedReference[];
}) {
  const { ft, config } = resolveField(field);
  if (ft.CellComponent) {
    const Cell = ft.CellComponent as unknown as FC<{ value: unknown; config: unknown; expanded?: unknown }>;
    return <Cell value={value} config={config} expanded={expanded} />;
  }
  return <span>{value == null ? '' : String(value)}</span>;
}

/** The generated edit/create form for a collection. Posts via Datastar to `action`.
 *  Pass `id` to associate an external submit (the EditorSidebar's Save button, item
 *  4). `renderActions={false}` omits the inline footer + #form-result so the sidebar
 *  owns them; leave it true for a standalone form. */
export function GeneratedForm({
  def,
  doc,
  action,
  submitLabel,
  id,
  renderActions = true,
}: {
  def: CollectionDefinition;
  doc?: DocumentRecord;
  action: string;
  submitLabel: string;
  id?: string;
  renderActions?: boolean;
}) {
  return (
    <form
      id={id}
      class="flex flex-col gap-6"
      data-signals="{busy: false}"
      data-on:submit={`@post('${action}', {contentType: 'form'})`}
    >
      <div class="flex flex-col gap-5">
        {def.fields.map((field) => (
          <FieldEditor field={field} value={doc?.data[field.key]} />
        ))}
      </div>
      {renderActions ? (
        <>
          {/* Morph target for the inline save-error fragment (200, #form-result). */}
          <div id="form-result" />
          <div class="flex items-center gap-3">
            <Button type="submit" busy="$busy">
              {submitLabel}
            </Button>
            <a href={`/admin/c/${def.slug}`} class="text-sm text-ink-muted hover:text-ink hover:underline">
              Cancel
            </a>
          </div>
        </>
      ) : null}
    </form>
  );
}

/** The generated list view: columns from `showInList` fields (or the first field).
 *  `settings` (optional) tunes the "Updated" timestamp's timezone/format.
 *  `selectable` (D39) adds a leading checkbox column and a bulk-action bar,
 *  wrapping everything in ONE classic form POSTing to `/admin/c/:slug/bulk` —
 *  no signals for the submission (nanoid ids make poor signal names; works
 *  without JS), just a select-all convenience one-liner. */
export function GeneratedTable({
  def,
  rows,
  settings,
  selectable = false,
}: {
  def: CollectionDefinition;
  rows: ExpandedDocument[];
  settings?: SiteSettings;
  selectable?: boolean;
}) {
  const columns = def.fields.filter((f) => f.admin?.showInList);
  const cols = columns.length ? columns : def.fields.slice(0, 1);
  // lifecycle:'none' collections suppress the Status affordance — a record is
  // not a draft blog post (B4). They can still be publicRead + non-public
  // visibility though, so the visibility stamp gets its OWN column in that
  // case (showVisibilityCol) rather than being hidden along with Status.
  const showStatus = hasLifecycle(def);
  const showVisibilityCol = !showStatus && def.access?.publicRead === true;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${def.name.toLowerCase()} yet`}
        description="Create the first one to get started."
        action={<Button href={`/admin/c/${def.slug}/new`}>New {def.name}</Button>}
      />
    );
  }

  const table = (
    <Table aria-label={`${def.name} list`}>
      <TableHead>
        <TableRow>
          {selectable ? (
            <TableHeaderCell class="w-10">
              {/* Select-all: pure DOM convenience — the FORM is the state. */}
              <Checkbox
                aria-label="Select all rows"
                data-on:change="el.closest('form').querySelectorAll('input[name=ids]').forEach((cb) => { cb.checked = el.checked })"
              />
            </TableHeaderCell>
          ) : null}
          {cols.map((f) => (
            <TableHeaderCell>{fieldLabel(f)}</TableHeaderCell>
          ))}
          {showStatus ? <TableHeaderCell>Status</TableHeaderCell> : null}
          {showVisibilityCol ? <TableHeaderCell>Visibility</TableHeaderCell> : null}
          <TableHeaderCell>Updated</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((doc) => (
          <TableRow>
            {selectable ? (
              <TableCell class="w-10">
                <Checkbox name="ids" value={doc.id} aria-label={`Select ${titleOf(def, doc)}`} />
              </TableCell>
            ) : null}
            {cols.map((f, i) => (
              <TableCell>
                {i === 0 ? (
                  // The first column is wrapped in the row link — skip expansion
                  // there (a relation cell would nest <a> inside <a>).
                  <a href={`/admin/c/${def.slug}/${doc.id}`} class="font-medium text-accent-text hover:underline">
                    <FieldCell field={f} value={doc.data[f.key]} />
                  </a>
                ) : (
                  <FieldCell field={f} value={doc.data[f.key]} expanded={doc.relations?.[f.key]} />
                )}
              </TableCell>
            ))}
            {showStatus ? (
              <TableCell>
                <span class="flex items-center gap-1.5">
                  <Badge tone={doc.status === 'published' ? 'success' : 'neutral'}>{doc.status}</Badge>
                  {/* Visibility (D50): only meaningful on publicRead collections —
                      public is the unmarked default, so only flag the exceptions. */}
                  {def.access?.publicRead && doc.visibility !== 'public' ? (
                    <Stamp tone="event" class="text-[10px]">
                      {doc.visibility}
                    </Stamp>
                  ) : null}
                </span>
              </TableCell>
            ) : showVisibilityCol ? (
              <TableCell>
                {doc.visibility !== 'public' ? (
                  <Stamp tone="event" class="text-[10px]">
                    {doc.visibility}
                  </Stamp>
                ) : null}
              </TableCell>
            ) : null}
            <TableCell>
              <span class="font-mono text-xs text-ink-subtle">{formatDate(doc.updatedAt, settings)}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (!selectable) return table;

  return (
    <form method="post" action={`/admin/c/${def.slug}/bulk`}>
      {table}
      {/* The bulk bar — sticky so it stays reachable on long pages. Buttons are
          the op dispatch; publish/unpublish only for lifecycle collections
          (setPublished enforces hasLifecycle — B4). */}
      <div class="sticky bottom-2 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-2.5 shadow-md">
        <span class="text-sm font-medium text-ink">With selected:</span>
        {showStatus ? (
          <>
            <Button type="submit" name="op" value="publish" variant="secondary" size="sm">
              Publish
            </Button>
            <Button type="submit" name="op" value="unpublish" variant="secondary" size="sm">
              Unpublish
            </Button>
          </>
        ) : null}
        <Button type="submit" name="op" value="trash" variant="danger" size="sm">
          Move to trash
        </Button>
        <span class="text-xs text-ink-subtle">Trash is recoverable for 30 days.</span>
      </div>
    </form>
  );
}
