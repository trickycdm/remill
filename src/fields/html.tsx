/**
 * `html` — raw, TRUSTED HTML content (D25). The value renders VERBATIM via
 * dangerouslySetInnerHTML: this is the codebase's second sanctioned XSS
 * exception (SECURITY_STANDARDS.md §7; the first is markdown, which sanitizes).
 * It exists for content markdown can't express — charts, graphs, rich visuals —
 * with inline <script>/<style>/SVG executing under the public-page CSP.
 *
 * TRUST MODEL — read before using this type:
 *  - Field-level access (`FieldAccess`) is RESERVED and ignored in v1, so the
 *    ONLY gate is collection-level write permission. ANY principal (human or
 *    agent) who can create/update in a collection containing an `html` field is
 *    authoring executable markup on your origin. Scope those collections to
 *    trusted roles.
 *  - The field auto-surfaces as a writable string on REST + MCP by design
 *    (agents author HTML; that's the point) — the same collection-write gate
 *    applies there.
 *  - External scripts stay CSP-blocked unless vendored under /vendor/ or the
 *    admin enables the CDN-allowlist setting (D27).
 */

import { z } from 'zod';
import { Textarea } from '@/components/ui';
import { FieldShell, controlProps, requiredNonEmpty } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

/** Fallback cap when an html field declares no `maxLength` — generous for full
 *  pages but bounded (SEC-4). A configured `maxLength` stays authoritative. */
const HTML_DEFAULT_MAX_LENGTH = 1_000_000;

const configSchema = z
  .object({
    maxLength: z.number().int().positive().optional(),
  })
  .strict();

type HtmlConfig = z.infer<typeof configSchema>;

function valueSchema(cfg: HtmlConfig, field: FieldDescriptor) {
  const s = z.string().max(cfg.maxLength ?? HTML_DEFAULT_MAX_LENGTH);
  return requiredNonEmpty(s, field);
}

/** Strip tags (script/style bodies included) to a searchable plain-text lead-in. */
function toPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const htmlField: FieldType<HtmlConfig, string> = {
  key: 'html',
  configSchema,
  valueSchema,
  // A searchable plain-text lead-in (value_text). Not the full document.
  toIndex: (v) => (v ? toPlainText(v).slice(0, 200) : null),
  EditComponent: ({ field, value, signal }) => (
    <FieldShell field={field} signal={signal}>
      <Textarea {...controlProps({ field, signal })} value={value ?? ''} rows={20} class="font-mono" />
    </FieldShell>
  ),
  CellComponent: ({ value }) => <span>{value ? toPlainText(value).slice(0, 80) : ''}</span>,
  // SANCTIONED EXCEPTION (D25): the value is emitted verbatim — no sanitizer.
  // Trust is the collection's write permission; see the module header.
  ViewComponent: ({ value }) => (value ? <div class="rm-html" dangerouslySetInnerHTML={{ __html: value }} /> : null),
};
