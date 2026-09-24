/**
 * ScopePicker — the shared action-permission selector used by every access
 * surface (token scope, role permissions, per-document item grants). It replaces
 * three hand-rolled `<input type="checkbox" class="accent-accent">` blocks with
 * the real Checkbox primitive, grouped and labelled, plus optional quick presets
 * and a native <details> disclosure for the full action grid.
 *
 * SEMANTICS LIVE WITH THE CALLER, not here: a preset simply checks *exactly* the
 * actions it lists. So a token's "Full access" preset lists `[]` (an empty scope
 * = no narrowing = inherit the principal's own permissions), while a role's
 * "Full" preset lists every action. The component only wires the DOM — it holds
 * no opinion about what an empty selection means.
 *
 * NO GLOBAL SIGNALS: presets set the checkboxes via a DOM query scoped to this
 * picker's `data-scope-root`, and the disclosure is a native <details>. That lets
 * many independent pickers share one page (e.g. one per principal card on
 * /admin/access) without their signals colliding — the failure mode a shared
 * `$act_read` signal would cause.
 *
 * Submitted state is the checkbox DOM state, which `@post(..., {contentType:
 * 'form'})` serialises directly — the preset radios are pure UI (their own name
 * is card-unique and ignored server-side).
 */

import type { JSX } from 'hono/jsx/jsx-runtime';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

/** Human labels for the closed action vocabulary (SCHEMA_ENGINE / ACCESS_CONTROL). */
export const ACCESS_ACTION_LABELS: Record<string, string> = {
  read: 'Read',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  publish: 'Publish',
  share_link: 'Share links',
  comment: 'Comment',
  manage_schema: 'Manage schema',
  manage_access: 'Manage access',
};

/** The 9-action vocabulary grouped into tiers (tokens + roles reuse this). */
export const ACCESS_ACTION_GROUPS: readonly ScopeGroup[] = [
  {
    label: 'Content',
    actions: ['read', 'create', 'update', 'delete', 'publish'].map((v) => ({ value: v, label: ACCESS_ACTION_LABELS[v] })),
  },
  {
    label: 'Sharing',
    actions: ['share_link', 'comment'].map((v) => ({ value: v, label: ACCESS_ACTION_LABELS[v] })),
  },
  {
    label: 'Administration',
    actions: ['manage_schema', 'manage_access'].map((v) => ({ value: v, label: ACCESS_ACTION_LABELS[v] })),
  },
];

export interface ScopeActionOption {
  readonly value: string;
  readonly label?: string;
}

export interface ScopeGroup {
  readonly label: string;
  readonly actions: readonly ScopeActionOption[];
}

export interface ScopePreset {
  readonly key: string;
  readonly label: string;
  /** Actions this preset selects. `[]` = clear all; `null` = "Custom" (leave the
   *  current selection, just open the disclosure). */
  readonly actions: readonly string[] | null;
}

/** Token scope presets. "Full access" is `[]`: an empty mask = no narrowing. */
export const TOKEN_SCOPE_PRESETS: readonly ScopePreset[] = [
  { key: 'full', label: 'Full access', actions: [] },
  { key: 'readonly', label: 'Read-only', actions: ['read'] },
  { key: 'editor', label: 'Editor', actions: ['read', 'create', 'update', 'delete', 'publish'] },
  { key: 'custom', label: 'Custom', actions: null },
];

/** The preset key whose action set exactly matches `actions`, else 'custom'. */
export function tokenPresetFor(actions: readonly string[]): string {
  const want = [...actions].sort().join(',');
  const hit = TOKEN_SCOPE_PRESETS.find((p) => p.actions !== null && [...p.actions].sort().join(',') === want);
  return hit?.key ?? 'custom';
}

interface ScopePickerProps {
  /** Unique per instance (e.g. `tok-${principalId}`) — namespaces the radio group. */
  idPrefix: string;
  /** Form field name for the action checkboxes (`scopeAction` | `action`). */
  name: string;
  groups: readonly ScopeGroup[];
  /** Initially-checked action values. */
  checked?: ReadonlySet<string>;
  /** Optional quick presets; when omitted the action grid renders inline (no disclosure). */
  presets?: readonly ScopePreset[];
  /** Key of the initially-selected preset. */
  defaultPreset?: string;
  /** Optional collection selector (tokens only). */
  collection?: { name: string; options: readonly string[]; selected?: string };
  /** Helper text under the picker. */
  help?: string;
  /** Open the <details> disclosure on first render. */
  advancedOpen?: boolean;
}

/** JS array literal of single-quoted action strings — safe (closed vocabulary),
 *  avoids double-quote escaping inside the double-quoted `data-on:*` attribute. */
function actionsLiteral(actions: readonly string[]): string {
  return `[${actions.map((a) => `'${a}'`).join(',')}]`;
}

function ActionGroups({ name, groups, checked }: { name: string; groups: readonly ScopeGroup[]; checked: ReadonlySet<string>; }) {
  return (
    <div class="flex flex-col gap-3">
      {groups.map((g) => (
        <fieldset class="flex flex-col gap-1.5">
          {groups.length > 1 && (
            <legend class="mb-1 text-eyebrow font-medium tracking-wide text-ink-subtle uppercase">{g.label}</legend>
          )}
          <div class="flex flex-wrap gap-x-4 gap-y-2">
            {g.actions.map((a) => (
              <label class="inline-flex items-center gap-2 text-sm text-ink-muted">
                <Checkbox name={name} value={a.value} checked={checked.has(a.value)} />
                {a.label ?? a.value}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function ScopePicker({
  idPrefix,
  name,
  groups,
  checked = new Set<string>(),
  presets,
  defaultPreset,
  collection,
  help,
  advancedOpen = false,
}: ScopePickerProps): JSX.Element {
  // The custom preset (if any) MUST use key 'custom' — the disclosure's change
  // handler flips that radio when a box is hand-edited.
  const hasCustom = !!presets?.some((p) => p.actions === null);

  return (
    <div class="flex flex-col gap-3" data-scope-root="">
      {collection && (
        <FormField fieldId={`${idPrefix}-col`} label="Collection" class="sm:max-w-xs">
          <Select id={`${idPrefix}-col`} name={collection.name}>
            <option value="*">All collections</option>
            {collection.options.map((s) => (
              <option value={s} selected={s === collection.selected}>
                {s}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      {presets && presets.length > 0 ? (
        <div class="flex flex-col gap-2">
          <fieldset class="flex flex-col gap-1.5">
            <legend class="mb-1 text-sm font-medium text-ink">Permissions</legend>
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              {presets.map((pr) => (
                <label class="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                  <input
                    type="radio"
                    name={`preset-${idPrefix}`}
                    value={pr.key}
                    checked={pr.key === defaultPreset}
                    class="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    data-on:change={
                      pr.actions === null
                        ? `el.closest('[data-scope-root]').querySelector('details').open = true`
                        : `el.closest('[data-scope-root]').querySelectorAll("input[name='${name}']").forEach((cb) => { cb.checked = ${actionsLiteral(pr.actions)}.includes(cb.value) })`
                    }
                  />
                  {pr.label}
                </label>
              ))}
            </div>
          </fieldset>
          {help && <p class="text-[13px] leading-normal text-ink-muted">{help}</p>}
          <details class="group" open={advancedOpen || undefined}>
            <summary class="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <span class="transition-transform group-open:rotate-90" aria-hidden="true">
                ›
              </span>
              Individual actions
            </summary>
            <div
              class="mt-3"
              // Hand-editing a box means the choice is no longer a named preset — reflect that.
              {...(hasCustom
                ? {
                    'data-on:change': `el.closest('[data-scope-root]').querySelector("input[name='preset-${idPrefix}'][value='custom']").checked = true`,
                  }
                : {})}
            >
              <ActionGroups name={name} groups={groups} checked={checked} />
            </div>
          </details>
        </div>
      ) : (
        <div class="flex flex-col gap-2">
          {help && <p class="text-[13px] leading-normal text-ink-muted">{help}</p>}
          <ActionGroups name={name} groups={groups} checked={checked} />
        </div>
      )}
    </div>
  );
}
