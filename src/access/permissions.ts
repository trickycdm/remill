/**
 * The pure decision logic (steering/ACCESS_CONTROL.md). `decide()` takes fully
 * resolved inputs (no DB) and returns allow/deny — default deny, additive-only.
 * authorize() (authorize.ts) does the loading and calls this.
 *
 * Layers, all additive:
 *   1. Role permissions (with conditions own/published).
 *   2. publicRead sugar (read of published documents).
 *   3. Per-document item grants.
 * A token scope mask, if present, NARROWS the result (effective = perms ∩ mask) —
 * it can shrink an agent's blast radius but never widen it.
 */

import type { Action, Condition, Principal, Resource } from '@/access/types';
import type { EffectivePermission } from '@/db/queries/roles';
import type { ItemGrantRecord } from '@/db/queries/grants';

/** One entry of a token's narrowing scope mask. */
export interface TokenScopeEntry {
  readonly collection: string; // '*' or a slug
  readonly action: Action;
}

export interface Decision {
  readonly principal: Principal;
  readonly action: Action;
  readonly resource: Resource;
  readonly permissions: readonly EffectivePermission[];
  readonly grants: readonly ItemGrantRecord[]; // applicable grants for the document
  readonly publicRead: boolean; // collection.access.publicRead
  readonly tokenScope?: readonly TokenScopeEntry[]; // narrowing mask (undefined = no narrowing)
}

function conditionSatisfied(condition: Condition | null, resource: Resource, principal: Principal): boolean {
  if (!condition) return true;
  if (condition === 'own') return resource.createdBy === principal.id;
  if (condition === 'published') return resource.status === 'published';
  return false;
}

function scopeAllows(scope: readonly TokenScopeEntry[], action: Action, collection: string): boolean {
  return scope.some((s) => s.action === action && (s.collection === '*' || s.collection === collection));
}

export function decide(input: Decision): boolean {
  const { principal, action, resource, permissions, grants, publicRead, tokenScope } = input;

  // Token scope mask narrows everything below.
  if (tokenScope && !scopeAllows(tokenScope, action, resource.collection)) return false;

  const isItem = !!resource.documentId;

  // 1. Role permissions.
  for (const p of permissions) {
    if (p.collection !== '*' && p.collection !== resource.collection) continue;
    if (p.action !== action) continue;
    // Collection-level ops (create, or list-read with no documentId): the op is
    // permitted; row-level conditions are enforced by the compiled list filter.
    if (!isItem) return true;
    if (conditionSatisfied(p.condition, resource, principal)) return true;
  }

  // 2. publicRead sugar — anyone may read published docs of a publicRead collection.
  if (action === 'read' && publicRead) {
    if (!isItem) return true; // list; filter restricts to published
    if (resource.status === 'published') return true;
  }

  // 3. Item grants (document-level only).
  if (isItem) {
    for (const g of grants) if (g.actions.includes(action)) return true;
  }

  return false;
}
