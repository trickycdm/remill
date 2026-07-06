/**
 * Access-control vocabulary (steering/ACCESS_CONTROL.md). Deliberately small and
 * closed: extending either the action set or the condition set requires a
 * decision-log entry (plan §8). Default-deny, additive-only, no negative rules.
 */

/** The closed action vocabulary. `share_link` (D26) is the right to mint an
 *  anonymous, expiring `/s/:token` share link for a readable document — split
 *  out of `manage_access` so it can be granted to an agent WITHOUT giving it
 *  any access-management power. */
export const ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
  'share_link',
  'manage_schema',
  'manage_access',
] as const;
export type Action = (typeof ACTIONS)[number];

/** The closed condition enum (never arbitrary code). */
export type Condition = 'own' | 'published';

/** The surface a request came through — recorded on every audit row. */
export type Surface = 'admin' | 'rest' | 'mcp';

/** A principal: every actor (human or agent) resolves to one before any decision.
 *  Permissions come from `principal_roles` (resolved by authorize), NOT from a
 *  field here — `kind` and `surface` are for attribution only. */
export interface Principal {
  readonly id: string; // prn_…
  readonly kind: 'user' | 'agent';
  /** The surface + token this request arrived on (for audit attribution). */
  readonly surface: Surface;
  readonly tokenId?: string;
  /** Optional narrowing scope mask from the bearer token (REST/MCP). Sessions
   *  carry none. Effective permission = principal's permissions ∩ this mask. */
  readonly tokenScope?: readonly { readonly collection: string; readonly action: Action }[];
  /** The HASHED share-link token this request arrived through (C3), matched
   *  against `item_grants` rows with subjectKind 'link'. Carried only by the
   *  public share route's synthetic anonymous principal — it ADDS one document's
   *  granted actions and nothing else (additive, like every grant). */
  readonly linkId?: string;
}

/** What an action targets. `collection` is always known; document specifics are
 *  present for item-level decisions. */
export interface Resource {
  readonly collection: string;
  readonly documentId?: string;
  readonly status?: 'draft' | 'published';
  readonly createdBy?: string;
}

/** Stable string form of a resource for the audit log. */
export function resourceKey(r: Resource): string {
  return r.documentId ? `document:${r.documentId}` : `collection:${r.collection}`;
}
