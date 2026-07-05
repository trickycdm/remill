/**
 * `markdown` — a multi-line Markdown-source field. The value is the raw Markdown
 * text (agent-legible, decision D3). Phase 4 swaps the plain <textarea> for a
 * CodeMirror island; a textarea is the correct baseline widget for now.
 */

import { z } from 'zod';
import { Textarea } from '@/components/ui';
import { FieldShell, controlProps, requiredNonEmpty } from '@/fields/field-shell';
import { renderMarkdown } from '@/lib/markdown';
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
  EditComponent: ({ field, value, signal }) => (
    <FieldShell field={field} signal={signal}>
      <Textarea {...controlProps({ field, signal })} value={value ?? ''} rows={12} />
    </FieldShell>
  ),
  CellComponent: ({ value }) => <span>{value ? value.slice(0, 80) : ''}</span>,
  // Read/detail surfaces render the SOURCE through the sanitizing renderer
  // (raw HTML escaped, dangerous protocols stripped — src/lib/markdown, D23).
  ViewComponent: ({ value }) =>
    value ? <div class="rm-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} /> : null,
};
