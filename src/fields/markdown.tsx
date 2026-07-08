/**
 * `markdown` — a multi-line Markdown-source field. The value is the raw Markdown
 * text (agent-legible, decision D3). The widget is a plain <textarea> that the
 * CodeMirror island (src/client/markdown-editor.ts, D38/D13) progressively
 * enhances on the editor routes: the textarea stays in the DOM as the
 * form/Datastar value carrier (§g); without JS it simply stays visible.
 */

import { z } from 'zod';
import { Textarea } from '@/components/ui';
import { FieldShell, controlProps, requiredNonEmpty } from '@/fields/field-shell';
import { renderMarkdown } from '@/lib/markdown';
import { fieldLabel } from '@/lib/humanize';
import type { FieldType, FieldDescriptor } from '@/fields/types';

/** Fallback cap when a markdown field declares no `maxLength` — generous for long
 *  documents but bounded (SEC-4). A configured `maxLength` stays authoritative. */
const MARKDOWN_DEFAULT_MAX_LENGTH = 1_000_000;

const configSchema = z
  .object({
    maxLength: z.number().int().positive().optional(),
  })
  .strict();

type MarkdownConfig = z.infer<typeof configSchema>;

function valueSchema(cfg: MarkdownConfig, field: FieldDescriptor) {
  const s = z.string().max(cfg.maxLength ?? MARKDOWN_DEFAULT_MAX_LENGTH);
  return requiredNonEmpty(s, field);
}

/** Crudely strip common Markdown syntax to a searchable plain-text preview. */
function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // images / links → their text
    .replace(/^[#>\s]*|[*_~>#-]+/gm, ' ') // headings, blockquotes, emphasis marks
    .replace(/\s+/g, ' ')
    .trim();
}

export const markdownField: FieldType<MarkdownConfig, string> = {
  key: 'markdown',
  configSchema,
  valueSchema,
  // A searchable plain-text lead-in (value_text). Not the full document.
  toIndex: (v) => (v ? toPlainText(v).slice(0, 200) : null),
  // The FULL plain text feeds the FTS5 search index (D28).
  toSearchText: (v) => (v ? toPlainText(v) : null),
  EditComponent: ({ field, value, signal }) => (
    <FieldShell field={field} signal={signal}>
      {/* The island mounts CodeMirror here and sr-only's the textarea; the
          label text rides data-label for the editor's aria-label. */}
      <div data-md-editor data-label={fieldLabel(field)}>
        <Textarea {...controlProps({ field, signal })} value={value ?? ''} rows={12} />
      </div>
    </FieldShell>
  ),
  CellComponent: ({ value }) => <span>{value ? value.slice(0, 80) : ''}</span>,
  // Read/detail surfaces render the SOURCE through the sanitizing renderer
  // (raw HTML escaped, dangerous protocols stripped — src/lib/markdown, D23).
  ViewComponent: ({ value }) =>
    value ? <div class="rm-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} /> : null,
};
