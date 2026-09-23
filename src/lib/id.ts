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
  team: 'tem',
  teamMember: 'tmm', // team_members join rows
  teamInvite: 'tin', // team_invites rows (multi-use join links)
  trash: 'trh', // document_trash snapshots (D29)
  oauthClient: 'ocl', // oauth_clients — the id doubles as the public client_id (D48)
  oauthGrant: 'ogr', // oauth_grants — the durable human consent (D48)
  oauthCode: 'oco', // oauth_codes rows (the code itself is rmc_…, stored hashed)
  oauthDevice: 'odc', // oauth_device_codes rows (D48)
  comment: 'cmt', // comments rows — roots and replies (D55)
  reviewer: 'rvw', // review_reviewers rows (D55)
} as const;

type Entity = keyof typeof ID_PREFIX;

/** Generate a prefixed id, e.g. `newId('document')` → `doc_V1StGXR8_Z5jdHi6B`. */
export function newId(entity: Entity): string {
  return `${ID_PREFIX[entity]}_${nanoid()}`;
}
