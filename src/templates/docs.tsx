/**
 * The `docs` reading template (the docs pack's layout). A plain documentation
 * page: section eyebrow, the title, the markdown body — then the GRAPH surfaced
 * high: forward relations ("Related") and backlinks ("Referenced by") come
 * straight after the body, because cross-references are the point of a docs
 * collection, not an afterthought. No hero, no standfirst, no reading time, no
 * share bar (`wants: {}`). Prev/next ordering is deliberately deferred.
 */

import type { RenderTemplate } from '@/templates/types';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { FieldView } from '@/components/field-view';
import { Backlinks } from '@/components/backlinks';
import { dedupeBacklinks } from '@/templates/lib/dedupe-backlinks';
import { fieldLabel } from '@/lib/humanize';

export const docsTemplate: RenderTemplate = {
  key: 'docs',
  name: 'Docs',
  description:
    'Documentation page: section eyebrow, title, markdown body, with related links and ' +
    'backlinks surfaced right after the body. Binds best to title/section/body/related fields.',
  wants: {},
  Component: ({ def, doc, backlinks }) => {
    const layout = resolveConventionLayout(def, { wantHero: false, wantLead: false });
    const titleRaw = layout.titleField ? doc.data[layout.titleField.key] : undefined;
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : def.name;

    // Bespoke bindings: first select → the section eyebrow. Claimed here, so
    // excluded from the meta zone.
    const sectionField = def.fields.find((f) => f.type === 'select');
    const sectionValue = sectionField ? doc.data[sectionField.key] : undefined;

    const claimed = new Set([sectionField?.key]);
    const metaFields = layout.meta.filter((f) => !claimed.has(f.key) && doc.data[f.key] != null);

    return (
      <article class="flex flex-col gap-6">
        <header class="flex flex-col gap-2">
          {sectionField && sectionValue != null ? (
            <p class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
              <FieldView field={sectionField} value={sectionValue} surface="public" />
            </p>
          ) : null}
          <h1 class="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">
            {title}
          </h1>
        </header>

        {layout.body.map((field) => (
          <FieldView field={field} value={doc.data[field.key]} surface="public" />
        ))}

        {/* The graph, surfaced high: forward relations + reverse backlinks. */}
        {metaFields.length ? (
          <section
            aria-label="Related"
            class="mt-2 flex flex-col gap-4 border-t border-border pt-6"
          >
            {metaFields.map((field) => (
              <div class="flex flex-col gap-1">
                <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
                  {fieldLabel(field)}
                </span>
                <FieldView
                  field={field}
                  value={doc.data[field.key]}
                  expanded={doc.relations?.[field.key]}
                  media={doc.media?.[field.key]}
                  surface="public"
                />
              </div>
            ))}
          </section>
        ) : null}

        <Backlinks backlinks={dedupeBacklinks(backlinks, def, doc)} surface="public" />
      </article>
    );
  },
};
