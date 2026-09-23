/**
 * The `prompt` reading template (the prompt-library pack's layout). A prompt
 * card: title, then the prompt text in a mono panel with `{{variable}}`
 * placeholders highlighted, variable chips, and a model badge; remaining
 * markdown fields (usage notes, example output) follow as labelled prose.
 * Opts out of the article furniture (no hero, no standfirst, no reading time)
 * but keeps the share bar — copying a link to a prompt is the point.
 *
 * Highlighting is token-based (`splitPromptTokens`): the body is rendered as
 * alternating JSX text nodes and <mark> elements, so every character of user
 * content rides JSX auto-escaping — no raw HTML anywhere. This template's key
 * doubles as the semantic marker for the MCP prompts primitive.
 */

import type { RenderTemplate } from '@/templates/types';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import {
  promptBodyFieldOf,
  promptVariables,
  promptVariablesFieldOf,
  splitPromptTokens,
} from '@/templates/lib/prompt-shape';
import { FieldView } from '@/components/field-view';
import { Backlinks } from '@/components/backlinks';
import { dedupeBacklinks } from '@/templates/lib/dedupe-backlinks';
import { ShareBar } from '@/components/share-bar';
import { fieldLabel } from '@/lib/humanize';

export const promptTemplate: RenderTemplate = {
  key: 'prompt',
  name: 'Prompt',
  description:
    'Prompt card: the prompt text in a mono panel with {{variable}} placeholders highlighted, ' +
    'variable chips, a model badge, and labelled usage notes. No hero or standfirst.',
  wants: { shareBar: true },
  layoutOptions: { wantHero: false, wantLead: false },
  Component: ({ def, doc, backlinks, ctx }) => {
    const layout = resolveConventionLayout(def, { wantHero: false, wantLead: false });
    const titleRaw = layout.titleField ? doc.data[layout.titleField.key] : undefined;
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : def.name;

    // Bespoke claims: first markdown → the prompt panel, the `variables` tags
    // field → chips, first select → the model badge. Claimed here, so excluded
    // from the prose sections and the meta zone.
    const bodyField = promptBodyFieldOf(def);
    const variablesField = promptVariablesFieldOf(def);
    const modelField = def.fields.find((f) => f.type === 'select');
    const bodyRaw = bodyField ? doc.data[bodyField.key] : undefined;
    const body = typeof bodyRaw === 'string' ? bodyRaw : '';
    const variables = promptVariables(def, doc.data);
    const modelValue = modelField ? doc.data[modelField.key] : undefined;

    const claimed = new Set([bodyField?.key, variablesField?.key, modelField?.key]);
    const proseFields = layout.body.filter(
      (f) => !claimed.has(f.key) && doc.data[f.key] != null && doc.data[f.key] !== '',
    );
    const metaFields = layout.meta.filter((f) => !claimed.has(f.key) && doc.data[f.key] != null);

    return (
      <article class="flex flex-col gap-6">
        <header class="flex flex-col gap-3">
          <h1 class="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">
            {title}
          </h1>
          {variables.length || (modelField && modelValue != null) ? (
            <p class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
              {modelField && modelValue != null ? (
                <span class="inline-flex items-center rounded-full border border-border bg-surface px-2.5 py-0.5 font-medium text-ink-muted">
                  <FieldView field={modelField} value={modelValue} surface="public" />
                </span>
              ) : null}
              {variables.map((v) => (
                <code class="inline-flex items-center rounded-sm bg-accent-soft px-2 py-0.5 font-mono text-xs text-accent-text">
                  {'{{'}
                  {v}
                  {'}}'}
                </code>
              ))}
            </p>
          ) : null}
        </header>

        {body ? (
          <pre class="overflow-x-auto rounded-lg border border-border bg-surface p-4">
            <code class="font-mono text-sm leading-relaxed whitespace-pre-wrap text-ink">
              {splitPromptTokens(body).map((t) =>
                t.kind === 'var' ? (
                  <mark class="rounded-sm bg-accent-soft px-0.5 font-semibold text-accent-text">
                    {t.raw}
                  </mark>
                ) : (
                  t.value
                ),
              )}
            </code>
          </pre>
        ) : null}

        {proseFields.map((field) => (
          <section aria-label={fieldLabel(field)} class="flex flex-col gap-2">
            <h2 class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
              {fieldLabel(field)}
            </h2>
            <FieldView field={field} value={doc.data[field.key]} surface="public" />
          </section>
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

        <Backlinks backlinks={dedupeBacklinks(backlinks, def, doc)} surface="public" />
      </article>
    );
  },
};
