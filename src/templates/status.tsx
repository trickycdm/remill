/**
 * The `status` reading template (the collab pack's task page) — a plain-language
 * "where does this stand" view built for share links: title, the stage as a
 * Stamp, the goal as prose, any further markdown fields as highlighted callout
 * panels (the collab pack labels its rollup field "Needs a human"), quiet meta
 * rows (repo, branch), then the linked work — backlinks grouped by source
 * collection, newest first. The reporting IS this render: nobody writes a
 * status update, the page derives one from the record.
 *
 * Templates are pure (types.ts): backlinks carry only {id, title, status,
 * updatedAt}, so the linked-work lists show titles and dates — never field
 * data from the referrers. Anything the page must SAY belongs on the task
 * itself (the rollup convention). No hero, no reading time, no share bar
 * (`wants: {}`) — a share-link page never advertises further sharing.
 */

import type { RenderTemplate } from '@/templates/types';
import type { Backlink } from '@/services/documents';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { FieldView } from '@/components/field-view';
import { Stamp } from '@/components/ui/stamp';
import { fieldLabel, humanizeKey } from '@/lib/humanize';

/** Group reverse edges by their source collection, newest first within each
 *  group; groups ordered by their most recent referrer. */
function groupBacklinks(backlinks: Backlink[]): { collection: string; items: Backlink[] }[] {
  const groups = new Map<string, Backlink[]>();
  for (const b of backlinks) {
    const list = groups.get(b.collection) ?? [];
    list.push(b);
    groups.set(b.collection, list);
  }
  const byNewest = (a: Backlink, b: Backlink) => b.updatedAt.localeCompare(a.updatedAt);
  return [...groups.entries()]
    .map(([collection, items]) => ({ collection, items: items.sort(byNewest) }))
    .sort((a, b) => byNewest(a.items[0], b.items[0]));
}

export const statusTemplate: RenderTemplate = {
  key: 'status',
  name: 'Status',
  description:
    'Plain-language status page: title, a stage stamp, the goal as prose, callout panels for ' +
    'open questions, and linked work grouped by collection. Built for share links — the ' +
    'report derives from the record.',
  wants: {},
  Component: ({ def, doc, backlinks }) => {
    const layout = resolveConventionLayout(def, { wantHero: false, wantLead: false });
    const titleRaw = layout.titleField ? doc.data[layout.titleField.key] : undefined;
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : def.name;

    // Bespoke claims: first select → the stage Stamp. First markdown → the goal
    // prose; every FURTHER markdown field with content → a callout panel (the
    // collab pack labels its rollup "Needs a human").
    const stageField = def.fields.find((f) => f.type === 'select');
    const stageValue = stageField ? doc.data[stageField.key] : undefined;
    const [goalField, ...calloutFields] = layout.body.filter(
      (f) => doc.data[f.key] != null && doc.data[f.key] !== '',
    );

    const claimed = new Set([stageField?.key]);
    const metaFields = layout.meta.filter((f) => !claimed.has(f.key) && doc.data[f.key] != null);
    const groups = groupBacklinks(backlinks);

    return (
      <article class="flex flex-col gap-6">
        <header class="flex flex-col gap-3">
          <h1 class="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">
            {title}
          </h1>
          <p class="flex flex-wrap items-center gap-2">
            {stageField && stageValue != null ? (
              <Stamp tone="affirm">
                <FieldView field={stageField} value={stageValue} surface="public" />
              </Stamp>
            ) : null}
            <span class="font-mono text-xs text-ink-subtle">
              updated {doc.updatedAt.slice(0, 10)}
            </span>
          </p>
        </header>

        {goalField ? (
          <FieldView field={goalField} value={doc.data[goalField.key]} surface="public" />
        ) : null}

        {calloutFields.map((field) => (
          <section aria-label={fieldLabel(field)} class="rounded-lg bg-accent-soft p-4">
            <h2 class="font-mono text-eyebrow font-medium tracking-[0.1em] text-accent-text uppercase">
              {fieldLabel(field)}
            </h2>
            <div class="mt-1.5">
              <FieldView field={field} value={doc.data[field.key]} surface="public" />
            </div>
          </section>
        ))}

        {metaFields.length ? (
          <section aria-label="Details" class="flex flex-col gap-2 border-t border-border pt-5">
            {metaFields.map((field) => (
              <div class="flex flex-wrap items-baseline gap-2 text-sm">
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

        {groups.map((group) => (
          <section
            aria-label={humanizeKey(group.collection)}
            class="flex flex-col gap-2 border-t border-border pt-5"
          >
            <h2 class="font-display text-lg font-semibold tracking-tight text-ink">
              {humanizeKey(group.collection)}
              <span class="ml-2 font-mono text-xs font-normal text-ink-subtle">
                {group.items.length}
              </span>
            </h2>
            <ul class="flex flex-col gap-1.5">
              {group.items.map((b) => (
                <li class="flex flex-wrap items-baseline gap-2 text-sm">
                  <a href={`/${b.collection}/${b.id}`} class="text-accent-text hover:underline">
                    {b.title ?? b.id}
                  </a>
                  <span class="font-mono text-xs text-ink-subtle">{b.updatedAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    );
  },
};
