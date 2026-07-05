/**
 * `markdown` — a multi-line Markdown-source field. The value is the raw Markdown
 * text (agent-legible, decision D3). Phase 4 swaps the plain <textarea> for a
 * CodeMirror island; a textarea is the correct baseline widget for now.
 */

import { z } from 'zod';
import { Textarea, FormField } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

const configSchema = z
  .object({
    maxLength: z.number().int().positive().optional(),
  })
  .strict();

type MarkdownConfig = z.infer<typeof configSchema>;

function valueSchema(cfg: MarkdownConfig, field: FieldDescriptor) {
  let s = z.string();
  if (cfg.maxLength !== undefined) s = s.max(cfg.maxLength);
  return field.required ? s.min(1) : s.optional();
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
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description={field.admin?.help}
    >
      <Textarea
        id={signal}
        name={field.key}
        value={value ?? ''}
        rows={12}
        required={field.required}
        placeholder={field.admin?.placeholder}
        data-bind={signal}
      />
    </FormField>
  ),
  CellComponent: ({ value }) => <span>{value ? value.slice(0, 80) : ''}</span>,
};
