/**
 * Prefixed nanoid primary keys. Prefixes make IDs self-describing in logs and
 * prevent cross-entity confusion (CODING_CONVENTIONS.md). nanoid uses
 * `crypto.getRandomValues()` — cryptographically secure and enumeration-safe.
 * Never use auto-increment integers as external IDs.
 */

import { nanoid } from 'nanoid';

export const ID_PREFIX = {
  principal: 'prn',
  token: 'tok',
  collection: 'col', // reserved; collections are keyed by slug, not id
  document: 'doc',
  revision: 'rev',
  index: 'idx',
  media: 'med',
  role: 'rol',
  rolePermission: 'rlp', // role_permissions rows (distinct from the role itself)
  principalRole: 'pnr', // principal_roles join rows (NOT a principal — avoid prn_ collision)
  grant: 'grn',
  audit: 'aud',
  invite: 'inv', // invite_tokens rows (single-use set-password links)
} as const;

type Entity = keyof typeof ID_PREFIX;

/** Generate a prefixed id, e.g. `newId('document')` → `doc_V1StGXR8_Z5jdHi6B`. */
export function newId(entity: Entity): string {
  return `${ID_PREFIX[entity]}_${nanoid()}`;
}
