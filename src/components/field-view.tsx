/**
 * FieldView — the read-only render dispatcher (C1, D23): resolves a field's
 * `ViewComponent` and falls back to SAFE ESCAPED TEXT for types that don't opt
 * in. Shared by the admin detail view and the public pages (deliberately not
 * under components/admin/ — it must never drag in admin chrome).
 */

import type { FC } from 'hono/jsx';
import { resolveField } from '@/fields/registry';
import type { FieldDescriptor, ExpandedReference, MediaMeta } from '@/fields/types';
import { ANNOTATABLE_FIELD_TYPES } from '@/lib/anchor/canonical';

export function FieldView({
  field,
  value,
  expanded,
  media,
  surface,
}: {
  field: FieldDescriptor;
  value: unknown;
  expanded?: ExpandedReference | ExpandedReference[];
  media?: MediaMeta;
  surface: 'admin' | 'public';
}) {
  const { ft, config } = resolveField(field);
  // Public html/markdown output is the annotatable prose of a document (D55):
  // the wrapper tells the review island which field a selection is in, and is
  // the region whose text the server's canonical text mirrors (src/lib/anchor).
  if (surface === 'public' && ANNOTATABLE_FIELD_TYPES.has(field.type) && value) {
    const View = ft.ViewComponent as unknown as FC<{ field: FieldDescriptor; config: unknown; value: unknown; surface: 'public' }>;
    return (
      <div data-rm-annotatable data-rm-field={field.key}>
        <View field={field} config={config} value={value} surface={surface} />
      </div>
    );
  }
  if (ft.ViewComponent) {
    const View = ft.ViewComponent as unknown as FC<{
      field: FieldDescriptor;
      config: unknown;
      value: unknown;
      expanded?: unknown;
      media?: unknown;
      surface: 'admin' | 'public';
    }>;
    return (
      <View field={field} config={config} value={value} expanded={expanded} media={media} surface={surface} />
    );
  }
  if (value == null) return null;
  // Default: escaped text (JSX escapes interpolated strings — no raw HTML path).
  return <span>{Array.isArray(value) ? value.join(', ') : String(value)}</span>;
}
