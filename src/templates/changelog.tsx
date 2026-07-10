/**
 * The `changelog` reading template (the changelog pack's layout). A compact
 * dated release entry: the version as the H1, a header line of release date +
 * change-type badge (both read EXPLICITLY — a dated-entry format wants bespoke
 * placement, not labelled rows), then the markdown body. Deliberately opts OUT
 * of the article furniture: no hero, no standfirst, no reading time, no share
 * bar (`wants: {}` — the route loads no share island for this template).
 * Anything else lands in the quiet metadata zone; backlinks close the page.
 */

import type { RenderTemplate } from '@/templates/types';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { FieldView } from '@/components/field-view';
import { Backlinks } from '@/components/backlinks';
import { fieldLabel } from '@/lib/humanize';
import { hasLifecycle } from '@/lib/lifecycle';
import { formatDate } from '@/lib/format-date';

export const changelogTemplate: RenderTemplate = {
  key: 'changelog',
  name: 'Changelog',
  description:
    'Compact release-note entry: version as the title, release date and change-type badge, ' +
    'markdown body. No hero, standfirst, or share bar. Binds best to version/date/type/body fields.',
  wants: {},
  Component: ({ def, doc, backlinks, ctx }) => {
    const layout = resolveConventionLayout(def, { wantHero: false, wantLead: false });
    const titleRaw = layout.titleField ? doc.data[layout.titleField.key] : undefined;
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : def.name;

    // Bespoke header bindings: first datetime → the release date, first select
    // → the change-type badge. Claimed here, so excluded from the meta zone.
    const dateField = def.fields.find((f) => f.type === 'datetime');
    const typeField = def.fields.find((f) => f.type === 'select');
    const dateRaw = dateField ? doc.data[dateField.key] : undefined;
    const releaseDate = typeof dateRaw === 'string' && dateRaw.length ? dateRaw : null;
    const typeValue = typeField ? doc.data[typeField.key] : undefined;

    const published = hasLifecycle(def) && doc.publishedAt ? doc.publishedAt : null;
    const claimed = new Set([dateField?.key, typeField?.key]);
    const metaFields = layout.meta.filter((f) => !claimed.has(f.key) && doc.data[f.key] != null);

    return (
      <article class="flex flex-col gap-6">
        <header class="flex flex-col gap-3">
          <h1 class="font-serif text-3xl font-semibold leading-tight tracking-tight text-ink">
            {title}
          </h1>
          {releaseDate || published || typeValue != null ? (
            <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-subtle">
              {releaseDate ? (
                <time datetime={releaseDate}>{formatDate(releaseDate, ctx.settings)}</time>
              ) : published ? (
                <time datetime={published}>{formatDate(published, ctx.settings)}</time>
              ) : null}
              {typeField && typeValue != null ? (
                <span class="inline-flex items-center rounded-full border border-border bg-surface px-2.5 py-0.5 font-medium text-ink-muted">
                  <FieldView field={typeField} value={typeValue} surface="public" />
                </span>
              ) : null}
            </p>
          ) : null}
        </header>

        {layout.body.map((field) => (
          <FieldView field={field} value={doc.data[field.key]} surface="public" />
        ))}

        {metaFields.length ? (
          <section
            aria-label="Details"
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

        <Backlinks backlinks={backlinks} surface="public" />
      </article>
    );
  },
};
