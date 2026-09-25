/**
 * Shared read-only display pieces for the access directory (/admin/access) and
 * the principal detail page (/admin/access/principals/:id): connection health
 * and the plain-words token-access summary. Both surfaces must say the same
 * thing about the same principal, so the wording lives here once.
 */

import type { PrincipalRecord, TokenRecord } from '@/db/queries/principals';
import { relativeTime } from '@/lib/relative-time';
import { ACCESS_ACTION_GROUPS, ACCESS_ACTION_LABELS, TOKEN_SCOPE_PRESETS } from '@/components/ui';

export type HealthState = 'disabled' | 'no-token' | 'never' | 'connected';

export interface Health {
  readonly state: HealthState;
  readonly label: string;
}

/** Connection health from the freshest token use (resolvePrincipal stamps
 *  last_used_at on every authenticated REST/MCP call). Disabled wins: a
 *  disabled agent's tokens are refused however recently they were used. */
export function healthOf(p: PrincipalRecord, tokens: readonly TokenRecord[], now: string): Health {
  if (p.disabled) return { state: 'disabled', label: 'Disabled' };
  if (tokens.length === 0) return { state: 'no-token', label: 'No token yet' };
  const used = tokens.map((t) => t.lastUsedAt).filter((t): t is string => t !== null);
  if (used.length === 0) return { state: 'never', label: 'Never connected' };
  return { state: 'connected', label: `Connected · last used ${relativeTime(used.sort().at(-1)!, now)}` };
}

const DOT: Record<HealthState, string> = {
  disabled: 'bg-danger',
  'no-token': 'bg-border-strong',
  never: 'bg-warning',
  connected: 'bg-success',
};

/** Status dot + words — colour is never the only signal (A11Y). */
export function HealthLabel({ health, class: cls = '' }: { health: Health; class?: string }) {
  return (
    <span class={`inline-flex items-center gap-2 ${cls}`}>
      <span aria-hidden="true" class={`size-2 shrink-0 rounded-full ${DOT[health.state]}`} />
      {health.label}
    </span>
  );
}

const ALL_ACTIONS = ACCESS_ACTION_GROUPS.flatMap((g) => g.actions.map((a) => a.value));
const label = (a: string) => ACCESS_ACTION_LABELS[a] ?? a;

/**
 * Plain-words summary of a token's scope mask. An empty mask is "Full access"
 * (the token inherits the principal's roles); a mask matching a preset uses the
 * preset's name; a mask covering most actions names what is LEFT OUT, which is
 * the short and useful half ("All except Comment, Manage access").
 */
export function scopeSummary(scope: TokenRecord['scope']): string {
  if (!scope || scope.length === 0) return 'Full access';
  const byCollection = new Map<string, string[]>();
  for (const s of scope) byCollection.set(s.collection, [...(byCollection.get(s.collection) ?? []), s.action]);
  return [...byCollection]
    .map(([col, acts]) => {
      const where = col === '*' ? '' : ` on ${col}`;
      const want = [...acts].sort().join(',');
      const preset = TOKEN_SCOPE_PRESETS.find((p) => p.actions?.length && [...p.actions].sort().join(',') === want);
      if (preset) return `${preset.label}${where}`;
      const missing = ALL_ACTIONS.filter((a) => !acts.includes(a));
      if (missing.length > 0 && missing.length < acts.length) {
        return `All except ${missing.map(label).join(', ')}${where}`;
      }
      return `${acts.map(label).join(', ')}${where}`;
    })
    .join(' · ');
}

/** The detail page for a principal. Built only from a well-formed id, so a
 *  form-supplied value can never turn a post-action redirect into an open
 *  redirect; anything else falls back to the directory. */
export function principalHref(id: string): string {
  return /^prn_[A-Za-z0-9_-]+$/.test(id) ? `/admin/access/principals/${id}` : '/admin/access';
}
