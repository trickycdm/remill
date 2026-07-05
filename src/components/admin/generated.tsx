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
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, Button, Badge, EmptyState } from '@/components/ui';

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
 *  `settings` (optional) tunes the "Updated" timestamp's timezone/format. */
export function GeneratedTable({
  def,
  rows,
  settings,
}: {
  def: CollectionDefinition;
  rows: ExpandedDocument[];
  settings?: SiteSettings;
}) {
  const columns = def.fields.filter((f) => f.admin?.showInList);
  const cols = columns.length ? columns : def.fields.slice(0, 1);
  // lifecycle:'none' collections suppress the Status affordance — a record is
  // not a draft blog post (B4).
  const showStatus = hasLifecycle(def);

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${def.name.toLowerCase()} yet`}
        description="Create the first one to get started."
        action={<Button href={`/admin/c/${def.slug}/new`}>New {def.name}</Button>}
      />
    );
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          {cols.map((f) => (
            <TableHeaderCell>{fieldLabel(f)}</TableHeaderCell>
          ))}
          {showStatus ? <TableHeaderCell>Status</TableHeaderCell> : null}
          <TableHeaderCell>Updated</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((doc) => (
          <TableRow>
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
                <Badge tone={doc.status === 'published' ? 'success' : 'neutral'}>{doc.status}</Badge>
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
}
