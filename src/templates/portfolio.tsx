/**
 * The `portfolio` reading template (the portfolio pack's layout). Media-first:
 * the cover leads full-width, then the project title, a one-line summary, a
 * prominent link-out to the live project, the markdown body, and tags. There is
 * no dedicated URL field type, so the link-out is a text field keyed `link` by
 * pack convention — on collections without one it simply isn't rendered (an
 * unclaimed text field falls to the metadata zone like everything else).
 * Shares reader-share (`wants.shareBar`) but skips reading time — a showcase
 * page is browsed, not read end-to-end.
 */

import type { RenderTemplate } from '@/templates/types';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { FieldView } from '@/components/field-view';
import { Backlinks } from '@/components/backlinks';
import { ShareBar } from '@/components/share-bar';
import { fieldLabel } from '@/lib/humanize';

export const portfolioTemplate: RenderTemplate = {
  key: 'portfolio',
  name: 'Portfolio',
  description:
    'Media-first project showcase: full-width cover, title, one-line summary, prominent ' +
    'link-out, markdown body, tags, share bar. Binds best to title/cover/summary/link/body fields.',
  wants: { shareBar: true },
  Component: ({ def, doc, backlinks, ctx }) => {
    const layout = resolveConventionLayout(def);
    const titleRaw = layout.titleField ? doc.data[layout.titleField.key] : undefined;
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : def.name;

    const heroId = layout.hero ? doc.data[layout.hero.key] : undefined;
    const heroMeta = layout.hero ? doc.media?.[layout.hero.key] : undefined;
    const showHero = typeof heroId === 'string' && heroId.length > 0;

    const leadRaw = layout.lead ? doc.data[layout.lead.key] : undefined;
    const lead = typeof leadRaw === 'string' && leadRaw.trim() ? leadRaw : null;

    // Pack convention: a text field keyed `link` is the project's external URL.
    // Claimed here (rendered as the link-out), so excluded from the meta zone.
    const linkField = def.fields.find((f) => f.type === 'text' && f.key === 'link');
    const linkRaw = linkField ? doc.data[linkField.key] : undefined;
    const link = typeof linkRaw === 'string' && /^https?:\/\//.test(linkRaw) ? linkRaw : null;

    const claimed = new Set([linkField?.key]);
    const metaFields = layout.meta.filter((f) => !claimed.has(f.key) && doc.data[f.key] != null);

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
          <h1 class="font-serif text-4xl font-semibold leading-tight tracking-tight text-ink">
            {title}
          </h1>
          {lead ? <p class="rm-standfirst">{lead}</p> : null}
          {link ? (
            <p>
              <a
                href={link}
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-accent-text hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Visit the project
                <span aria-hidden="true">→</span>
              </a>
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

        {ctx.shareUrl ? <ShareBar url={ctx.shareUrl} title={title} /> : null}

        <Backlinks backlinks={backlinks} surface="public" />
      </article>
    );
  },
};
