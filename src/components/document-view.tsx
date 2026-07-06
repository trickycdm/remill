/**
 * DocumentView — the read-only rendering of ONE document (C2): an H1 from the
 * display-title field, every remaining populated field through the FieldView
 * seam (C1), and the "Referenced by" reverse edges (B3). Shared by the public
 * page and the admin detail view; `surface` routes relation/backlink hrefs to
 * public vs admin URLs. No admin imports — this must stay public-safe.
 */

import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';
import type { ExpandedDocument, Backlink } from '@/services/documents';
import { FieldView } from '@/components/field-view';
import { fieldLabel } from '@/lib/humanize';
import { hasLifecycle } from '@/lib/lifecycle';

function displayTitleField(def: CollectionDefinition): FieldDescriptor | undefined {
  return def.fields.find((f) => f.admin?.showInList) ?? def.fields[0];
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
  const titleField = displayTitleField(def);
  const rawTitle = titleField ? doc.data[titleField.key] : undefined;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : def.name;
  const rest = def.fields.filter(
    (f) => f !== titleField && doc.data[f.key] !== undefined && doc.data[f.key] !== null,
  );
  const backHref = (b: Backlink) =>
    surface === 'public' ? `/${b.collection}/${b.id}` : `/admin/c/${b.collection}/${b.id}`;

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
        field.type === 'markdown' ? (
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
              surface={surface}
            />
          </div>
        ),
      )}

      {backlinks.length ? (
        <section aria-labelledby="rm-backlinks-h" class="mt-4 border-t border-border pt-6">
          <h2 id="rm-backlinks-h" class="font-serif text-lg font-semibold tracking-tight text-ink">
            Referenced by
          </h2>
          <ul class="mt-3 flex flex-col gap-2">
            {backlinks.map((b) => (
              <li class="flex flex-wrap items-center gap-2">
                <a href={backHref(b)} class="text-accent-text hover:underline">
                  {b.title ?? b.id}
                </a>
                <span class="text-xs text-ink-subtle">{b.collection}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
