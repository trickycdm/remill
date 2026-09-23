/**
 * The `warp` reading template (the collab pack's session-handover layout). A
 * handover brief: title, a role badge and the task it belongs to, then the
 * single next action in a highlighted panel BEFORE the prose — a warp is read
 * by whoever picks the work up, and "what do I do first" outranks the
 * narrative. State and open questions follow as labelled sections; decisions
 * and code pointers land in the meta zone. No hero, no standfirst, no reading
 * time, no share bar (`wants: {}`) — working material, not publishing.
 *
 * Bespoke claims are positional, not keyed (first select → role, first
 * relation → task, first non-title text → next action), so hand-built
 * handover collections participate without matching the pack's field keys.
 * This template's key doubles as the semantic marker for text renders
 * (renders.ts) — the same convention the `prompt` key uses for the MCP
 * prompts primitive.
 */

import type { RenderTemplate } from '@/templates/types';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { FieldView } from '@/components/field-view';
import { Backlinks } from '@/components/backlinks';
import { dedupeBacklinks } from '@/templates/lib/dedupe-backlinks';
import { fieldLabel } from '@/lib/humanize';

export const warpTemplate: RenderTemplate = {
  key: 'warp',
  name: 'Warp',
  description:
    'Session-handover brief: role badge, the owning task, the next action in a highlighted ' +
    'panel, then state and open questions as labelled sections. Binds best to ' +
    'title/task/state/next-action fields.',
  wants: {},
  layoutOptions: { wantHero: false, wantLead: false },
  Component: ({ def, doc, backlinks }) => {
    const layout = resolveConventionLayout(def, { wantHero: false, wantLead: false });
    const titleRaw = layout.titleField ? doc.data[layout.titleField.key] : undefined;
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : def.name;
    const titleKey = layout.titleField?.key;

    // Bespoke claims: first select → the role badge, first relation → the
    // owning-task line, first non-title text → the next-action panel. Claimed
    // here, so excluded from the prose sections and the meta zone.
    const roleField = def.fields.find((f) => f.type === 'select');
    const taskField = def.fields.find((f) => f.type === 'relation');
    const nextActionField = def.fields.find((f) => f.type === 'text' && f.key !== titleKey);
    const roleValue = roleField ? doc.data[roleField.key] : undefined;
    const taskValue = taskField ? doc.data[taskField.key] : undefined;
    const nextActionRaw = nextActionField ? doc.data[nextActionField.key] : undefined;
    const nextAction =
      typeof nextActionRaw === 'string' && nextActionRaw.trim() ? nextActionRaw : undefined;

    const claimed = new Set([roleField?.key, taskField?.key, nextActionField?.key]);
    const proseFields = layout.body.filter(
      (f) => !claimed.has(f.key) && doc.data[f.key] != null && doc.data[f.key] !== '',
    );
    const metaFields = layout.meta.filter((f) => !claimed.has(f.key) && doc.data[f.key] != null);

    return (
      <article class="flex flex-col gap-6">
        <header class="flex flex-col gap-3">
          {roleField && roleValue != null ? (
            <p class="font-mono text-eyebrow font-medium tracking-[0.14em] text-ink-subtle uppercase">
              Written as <FieldView field={roleField} value={roleValue} surface="public" />
            </p>
          ) : null}
          <h1 class="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">
            {title}
          </h1>
          {taskField && taskValue != null ? (
            <p class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <span class="font-mono text-eyebrow font-medium tracking-[0.1em] text-ink-subtle uppercase">
                {fieldLabel(taskField)}
              </span>
              <FieldView
                field={taskField}
                value={taskValue}
                expanded={doc.relations?.[taskField.key]}
                surface="public"
              />
            </p>
          ) : null}
        </header>

        {nextActionField && nextAction ? (
          <section
            aria-label={fieldLabel(nextActionField)}
            class="rounded-lg bg-accent-soft p-4"
          >
            <h2 class="font-mono text-eyebrow font-medium tracking-[0.1em] text-accent-text uppercase">
              {fieldLabel(nextActionField)}
            </h2>
            <p class="mt-1.5 font-medium text-ink">{nextAction}</p>
          </section>
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

        <Backlinks backlinks={dedupeBacklinks(backlinks, def, doc)} surface="public" />
      </article>
    );
  },
};
