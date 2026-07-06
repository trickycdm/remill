/**
 * FieldView — the read-only render dispatcher (C1, D23): resolves a field's
 * `ViewComponent` and falls back to SAFE ESCAPED TEXT for types that don't opt
 * in. Shared by the admin detail view and the public pages (deliberately not
 * under components/admin/ — it must never drag in admin chrome).
 */

import type { FC } from 'hono/jsx';
import { resolveField } from '@/fields/registry';
import type { FieldDescriptor, ExpandedReference } from '@/fields/types';

export function FieldView({
  field,
  value,
  expanded,
  surface,
}: {
  field: FieldDescriptor;
  value: unknown;
  expanded?: ExpandedReference | ExpandedReference[];
  surface: 'admin' | 'public';
}) {
  const { ft, config } = resolveField(field);
  if (ft.ViewComponent) {
    const View = ft.ViewComponent as unknown as FC<{
      field: FieldDescriptor;
      config: unknown;
      value: unknown;
      expanded?: unknown;
      surface: 'admin' | 'public';
    }>;
    return <View field={field} config={config} value={value} expanded={expanded} surface={surface} />;
  }
  if (value == null) return null;
  // Default: escaped text (JSX escapes interpolated strings — no raw HTML path).
  return <span>{Array.isArray(value) ? value.join(', ') : String(value)}</span>;
}
