/**
 * The seeded system-role policy (steering/ACCESS_CONTROL.md). Roles are DATA
 * (rows in `roles`/`role_permissions`), so custom roles can be created at runtime;
 * this file is just the built-in set every install starts with. Default-deny,
 * additive-only — every row here GRANTS; there are no negative rules.
 */

import type { Action, Condition } from '@/access/types';

export interface PermissionSpec {
  readonly collection: string; // '*' or a slug
  readonly action: Action;
  readonly condition?: Condition;
}

export interface RoleSpec {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly PermissionSpec[];
}

// Keep in sync with ACTIONS (types.ts) and seed.sql — the drift-guard test in
// src/db/seed.test.ts fails loudly if the three diverge.
const ALL_ACTIONS: readonly Action[] = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
  'share_link',
  'comment',
  'manage_schema',
  'manage_access',
];

const EDITOR_ACTIONS: readonly Action[] = ['read', 'create', 'update', 'delete', 'publish', 'share_link', 'comment'];

const everywhere = (actions: readonly Action[]): PermissionSpec[] =>
  actions.map((action) => ({ collection: '*', action }));

export const SYSTEM_ROLES: readonly RoleSpec[] = [
  {
    slug: 'admin',
    name: 'Administrator',
    description: 'Full control over content, schema, and access.',
    permissions: everywhere(ALL_ACTIONS),
  },
  // D64: editor + schema. The role an OAuth-connected agent can be given (the
  // consent screen never offers admin) so it can define its own collections.
  {
    slug: 'builder',
    name: 'Builder',
    description: 'Everything an editor can do, plus create and change collections. No access management.',
    permissions: everywhere([...EDITOR_ACTIONS, 'manage_schema']),
  },
  {
    slug: 'editor',
    name: 'Editor',
    description: 'Create, edit, publish, and delete any content. No schema or access management.',
    permissions: everywhere(EDITOR_ACTIONS),
  },
  {
    slug: 'author',
    name: 'Author',
    description: 'Create content and edit their own drafts. Cannot publish or delete.',
    permissions: [
      { collection: '*', action: 'create' },
      { collection: '*', action: 'read', condition: 'published' },
      { collection: '*', action: 'read', condition: 'own' },
      { collection: '*', action: 'update', condition: 'own' },
      { collection: '*', action: 'comment', condition: 'own' },
    ],
  },
  {
    slug: 'reader',
    name: 'Reader',
    description: 'Read published content only.',
    permissions: [{ collection: '*', action: 'read', condition: 'published' }],
  },
  {
    slug: 'anonymous',
    name: 'Anonymous',
    description: 'Unauthenticated access. Reads published content only where publicRead is enabled.',
    permissions: [], // publicRead sugar grants anonymous reads of published docs
  },
];

export const SYSTEM_ROLE_SLUGS = SYSTEM_ROLES.map((r) => r.slug);
