/**
 * DocumentView — the read-only rendering of ONE document (C2): an H1 from the
 * display-title field, every remaining populated field through the FieldView
 * seam (C1), and the "Referenced by" reverse edges (B3). Shared by the public
 * page and the admin detail view; `surface` routes relation/backlink hrefs to
 * public vs admin URLs. No admin imports — this must stay public-safe.
 */

import type { CollectionDefinition } from '@/fields/types';
import type { ExpandedDocument, Backlink } from '@/services/documents';
import { FieldView } from '@/components/field-view';
import { Backlinks } from '@/components/backlinks';
import { fieldLabel } from '@/lib/humanize';
import { hasLifecycle } from '@/lib/lifecycle';
import { titleFieldOf } from '@/lib/def-helpers';

/**
 * Raw-mode page body (D27): when the collection opted into `renderMode: 'raw'`,
 * the FIRST `html` field IS the standalone page (the author brings the whole
 * document — no shell, no design-system CSS). Returns null when the collection
 * is shell-mode or the value is empty — callers fall back to the shell render
 * so a published page is never blank.
 */
export function rawPageHtml(def: CollectionDefinition, doc: ExpandedDocument): string | null {
  if (def.renderMode !== 'raw') return null;
  const htmlField = def.fields.find((f) => f.type === 'html');
  const page = htmlField ? doc.data[htmlField.key] : undefined;
  return typeof page === 'string' && page.trim() ? page : null;
}

export function DocumentView({
  def,
  doc,
  backlinks,
  surface,
}: {
  def: CollectionDefinition;
  doc: ExpandedDocument;
  backlinks: Backlink[];
  surface: 'admin' | 'public';
}) {
  const titleKey = titleFieldOf(def);
  const titleField = titleKey ? def.fields.find((f) => f.key === titleKey) : undefined;
  const rawTitle = titleField ? doc.data[titleField.key] : undefined;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : def.name;
  const rest = def.fields.filter(
    (f) => f !== titleField && doc.data[f.key] !== undefined && doc.data[f.key] !== null,
  );
  return (
    <article class="flex flex-col gap-6">
      <header>
        <h1 class="font-serif text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {hasLifecycle(def) && doc.publishedAt ? (
          <p class="mt-2 text-sm text-ink-subtle">
            <time datetime={doc.publishedAt}>{doc.publishedAt.slice(0, 10)}</time>
          </p>
        ) : null}
      </header>

      {rest.map((field) =>
        field.type === 'markdown' || field.type === 'html' ? (
          // Body content renders bare — a labelled chrome around prose reads
          // like a form, not a page.
          <FieldView field={field} value={doc.data[field.key]} surface={surface} />
        ) : (
          <div class="flex flex-col gap-1">
            <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
              {fieldLabel(field)}
            </span>
            <FieldView
              field={field}
              value={doc.data[field.key]}
              expanded={doc.relations?.[field.key]}
              media={doc.media?.[field.key]}
              surface={surface}
            />
          </div>
        ),
      )}

      <Backlinks backlinks={backlinks} surface={surface} />
    </article>
  );
}
