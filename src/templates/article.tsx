/**
 * The `article` reading template (the blog pack's layout). A calm editorial
 * composition: a lead hero image, one serif H1, a quiet meta line (date ·
 * reading time), a standfirst dek, the body prose, a metadata zone (tags,
 * relations, anything unclaimed), and the "Referenced by" backlinks. Field
 * binding is by convention (resolveConventionLayout) — the blog pack ships a
 * matching collection, and any field the convention doesn't claim still surfaces
 * in the metadata zone, so nothing silently disappears. Renders inside
 * PublicShell (the route wraps it), so masthead/footer/skip-link/landmarks and
 * the home link come free.
 */

import type { RenderTemplate } from '@/templates/types';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { FieldView } from '@/components/field-view';
import { Backlinks } from '@/components/backlinks';
import { ShareBar } from '@/components/share-bar';
import { fieldLabel } from '@/lib/humanize';
import { hasLifecycle } from '@/lib/lifecycle';
import { formatDate } from '@/lib/format-date';

export const articleTemplate: RenderTemplate = {
  key: 'article',
  name: 'Article',
  Component: ({ def, doc, backlinks, ctx }) => {
    const layout = resolveConventionLayout(def);
    const titleRaw = layout.titleField ? doc.data[layout.titleField.key] : undefined;
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : def.name;

    const heroId = layout.hero ? doc.data[layout.hero.key] : undefined;
    const heroMeta = layout.hero ? doc.media?.[layout.hero.key] : undefined;
    const showHero = typeof heroId === 'string' && heroId.length > 0;

    const leadRaw = layout.lead ? doc.data[layout.lead.key] : undefined;
    const lead = typeof leadRaw === 'string' && leadRaw.trim() ? leadRaw : null;

    const published = hasLifecycle(def) && doc.publishedAt ? doc.publishedAt : null;
    const metaFields = layout.meta.filter((f) => doc.data[f.key] != null);

    return (
      <article class="flex flex-col gap-8">
        {showHero ? (
          <figure class="m-0">
            <img
              src={`/media/${heroId}`}
              alt={heroMeta?.alt ?? ''}
              width={heroMeta?.width ?? undefined}
              height={heroMeta?.height ?? undefined}
              class="h-auto w-full rounded-xl"
            />
          </figure>
        ) : null}

        <header class="flex flex-col gap-4">
          <h1 class="font-serif text-4xl font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          {published || ctx.readingMinutes ? (
            <p class="flex flex-wrap items-center gap-x-2 text-sm text-ink-subtle">
              {published ? <time datetime={published}>{formatDate(published, ctx.settings)}</time> : null}
              {published && ctx.readingMinutes ? <span aria-hidden="true">·</span> : null}
              {ctx.readingMinutes ? <span>{ctx.readingMinutes} min read</span> : null}
            </p>
          ) : null}
          {lead ? <p class="rm-standfirst">{lead}</p> : null}
        </header>

        {layout.body.map((field) => (
          <FieldView field={field} value={doc.data[field.key]} surface="public" />
        ))}

        {metaFields.length ? (
          <section aria-label="Details" class="mt-2 flex flex-col gap-4 border-t border-border pt-6">
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

        {ctx.shareUrl ? <ShareBar url={ctx.shareUrl} title={title} /> : null}

        <Backlinks backlinks={backlinks} surface="public" />
      </article>
    );
  },
};
