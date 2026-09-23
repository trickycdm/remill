/**
 * Access-control vocabulary (steering/ACCESS_CONTROL.md). Deliberately small and
 * closed: extending either the action set or the condition set requires a
 * decision-log entry (plan §8). Default-deny, additive-only, no negative rules.
 */

import type { Visibility } from '@/lib/visibility';

/** The closed action vocabulary. `share_link` (D26) is the right to mint an
 *  anonymous, expiring `/s/:token` share link for a readable document — split
 *  out of `manage_access` so it can be granted to an agent WITHOUT giving it
 *  any access-management power. `comment` (D55) is the right to read and write
 *  review comments on a document — held by roles, by item grants, and by
 *  review links, which makes it the one action an anonymous link can use to
 *  WRITE (bounded to that document's comment threads). */
export const ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
  'share_link',
  'comment',
  'manage_schema',
  'manage_access',
] as const;
export type Action = (typeof ACTIONS)[number];

/** The closed condition enum (never arbitrary code). */
export type Condition = 'own' | 'published';

/** The surface a request came through — recorded on every audit row. `system`
 *  is the cron surface (D30): no request, no session, no token. */
export type Surface = 'admin' | 'rest' | 'mcp' | 'system';

/** A principal: every actor (human or agent) resolves to one before any decision.
 *  Permissions come from `principal_roles` (resolved by authorize), NOT from a
 *  field here — `kind` and `surface` are for attribution only. `kind: 'system'`
 *  is the platform itself acting from cron (D30): it has NO principals row and
 *  NO seeded permissions — authorize() allows it by kind, but still writes the
 *  audit row, so scheduled actions stay fully attributed. */
export interface Principal {
  readonly id: string; // prn_… ('system' / 'anonymous' for the built-ins)
  readonly kind: 'user' | 'agent' | 'system';
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
  /** Document visibility (D50); missing is treated as public. */
  readonly visibility?: Visibility;
}

/** Stable string form of a resource for the audit log. */
export function resourceKey(r: Resource): string {
  return r.documentId ? `document:${r.documentId}` : `collection:${r.collection}`;
}
