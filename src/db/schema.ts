/**
 * Fixed-table schema — the ONLY Drizzle-migrated schema. Dynamic content is
 * schema-as-data (a row in `collections`), never a table. See
 * steering/DATABASE_STANDARDS.md for conventions (JSON-as-text, booleans as 0/1,
 * ISO-8601 TEXT timestamps) and the full table catalog.
 *
 * Phasing: this file grows by phase. Phase 1 defines the identity + content
 * foundation below. Phase 2 adds `audit_log` (born-authorized writes). Phase 3
 * adds the RBAC tables (`roles`, `role_permissions`, `principal_roles`,
 * `item_grants`). Each addition is a new generated migration — never edit an
 * applied one.
 *
 * Drizzle Kit does NOT emit CHECK constraints or all needed indexes; the reviewed
 * migration SQL adds them (see DATABASE_STANDARDS.md → Migrations).
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Audit log — append-only. Born in Phase 2 ("born authorized"): every allow and
// every deny through authorize() writes one row (ACCESS_CONTROL.md). No update
// or delete path exists in code.
// ---------------------------------------------------------------------------

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(), // aud_…
    principalId: text('principal_id').notNull(),
    tokenId: text('token_id'), // null for session (admin) surface
    surface: text('surface').notNull(), // 'admin' | 'rest' | 'mcp'
    action: text('action').notNull(),
    resource: text('resource').notNull(), // e.g. 'collection:posts' or 'document:doc_x'
    allowed: integer('allowed').notNull(), // 0/1
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('audit_log_principal_idx').on(t.principalId),
    index('audit_log_created_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Principals — every actor (human or agent) is a principal (ACCESS_CONTROL.md)
// ---------------------------------------------------------------------------

export const principals = sqliteTable('principals', {
  id: text('id').primaryKey(), // prn_…
  kind: text('kind').notNull(), // 'user' | 'agent'  (CHECK added in migration)
  // Display/grouping only — the PERSONA a human manages (person | service | agent).
  // NOT security-relevant: authorize() and refuseAgentEscalation key off `kind`.
  // Nullable (legacy rows read as person/agent via personaOf); the value set is
  // enforced at the service layer, not a DB CHECK (SQLite can't add a column CHECK
  // without a table rebuild, and this attribute is inert to the security model).
  subtype: text('subtype'), // 'person' | 'service' | 'agent' | null
  name: text('name').notNull(),
  disabled: integer('disabled').notNull().default(0), // 0/1
  createdAt: text('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// Users — human credentials, one-to-one with a principal of kind 'user'
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    principalId: text('principal_id')
      .primaryKey()
      .references(() => principals.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(), // scrypt saltHex:hashHex
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

// ---------------------------------------------------------------------------
// API tokens — machine bearer tokens, hashed at rest, with a narrowing scope mask
// ---------------------------------------------------------------------------

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(), // tok_…
    principalId: text('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(), // SHA-256 hex — never plaintext
    scopeJson: text('scope_json'), // narrowing scope mask (null = no narrowing)
    expiresAt: text('expires_at'),
    lastUsedAt: text('last_used_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('api_tokens_hash_unique').on(t.tokenHash),
    index('api_tokens_principal_idx').on(t.principalId),
  ],
);

// ---------------------------------------------------------------------------
// Collections — content types stored AS DATA (the schema engine's substrate)
// ---------------------------------------------------------------------------

export const collections = sqliteTable('collections', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  shape: text('shape').notNull().default('collection'), // 'collection' | 'singleton'
  fieldsJson: text('fields_json').notNull().default('[]'), // FieldDescriptor[]
  workflowJson: text('workflow_json'), // { draftPublish?: boolean, ... }
  accessJson: text('access_json'), // { publicRead?: boolean } | role→action map
  protected: integer('protected').notNull().default(0), // seeded/system collections (0/1)
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Documents — content instances; data_json is the source of truth
// ---------------------------------------------------------------------------

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(), // doc_…
    collection: text('collection')
      .notNull()
      .references(() => collections.slug, { onDelete: 'cascade' }),
    dataJson: text('data_json').notNull().default('{}'),
    status: text('status').notNull().default('draft'), // 'draft' | 'published'
    createdBy: text('created_by').references(() => principals.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    publishedAt: text('published_at'),
  },
  (t) => [
    index('documents_collection_idx').on(t.collection),
    index('documents_collection_status_idx').on(t.collection, t.status),
    index('documents_created_by_idx').on(t.createdBy),
  ],
);

// ---------------------------------------------------------------------------
// Document revisions — append-only version history (Blogmill never had this)
// ---------------------------------------------------------------------------

export const documentRevisions = sqliteTable(
  'document_revisions',
  {
    id: text('id').primaryKey(), // rev_…
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(), // 1-based, monotonic per document
    dataJson: text('data_json').notNull(),
    savedBy: text('saved_by').references(() => principals.id),
    savedAt: text('saved_at').notNull(),
  },
  (t) => [
    uniqueIndex('document_revisions_doc_rev_unique').on(t.documentId, t.revision),
    index('document_revisions_doc_idx').on(t.documentId),
  ],
);

// ---------------------------------------------------------------------------
// Document index — the EAV query/sort/filter surface for JSON content (D4)
// One row per (document, indexed field). Synced on every save, in the same batch.
// ---------------------------------------------------------------------------

export const documentIndex = sqliteTable(
  'document_index',
  {
    id: text('id').primaryKey(), // idx_…
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    collection: text('collection').notNull(),
    fieldKey: text('field_key').notNull(),
    valueText: text('value_text'),
    valueNum: real('value_num'),
    // DB-level backing for `unique` fields (COR-8). Set to `${collection}:${fieldKey}`
    // ONLY for fields declared unique; NULL otherwise. Because SQLite treats NULLs
    // as distinct in a UNIQUE index, the two unique indexes below constrain unique
    // fields alone — non-unique indexed rows (unique_key NULL) never collide. This
    // makes uniqueness race-proof (the app-level check is a friendly pre-check only).
    uniqueKey: text('unique_key'),
  },
  (t) => [
    index('document_index_doc_idx').on(t.documentId),
    index('document_index_text_idx').on(t.collection, t.fieldKey, t.valueText),
    index('document_index_num_idx').on(t.collection, t.fieldKey, t.valueNum),
    // A unique field is either text- or number-indexed (one value column is NULL);
    // pairing unique_key with each column covers both without a cross-field clash
    // (unique_key embeds the field, so two unique fields never share a namespace).
    uniqueIndex('document_index_unique_text').on(t.uniqueKey, t.valueText),
    uniqueIndex('document_index_unique_num').on(t.uniqueKey, t.valueNum),
  ],
);

// ---------------------------------------------------------------------------
// Access control (Phase 3) — roles-as-data + scoped assignments + item grants.
// Default-deny, additive-only, no negative rules (steering/ACCESS_CONTROL.md).
// ---------------------------------------------------------------------------

export const roles = sqliteTable('roles', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  system: integer('system').notNull().default(0), // seeded/system roles (0/1)
  createdAt: text('created_at').notNull(),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    id: text('id').primaryKey(), // rlp_…
    role: text('role')
      .notNull()
      .references(() => roles.slug, { onDelete: 'cascade' }),
    collection: text('collection').notNull(), // '*' or a collection slug
    action: text('action').notNull(), // one of the closed action vocabulary
    condition: text('condition'), // null | 'own' | 'published'
  },
  (t) => [index('role_permissions_role_idx').on(t.role)],
);

export const principalRoles = sqliteTable(
  'principal_roles',
  {
    id: text('id').primaryKey(), // pnr_…
    principalId: text('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    role: text('role')
      .notNull()
      .references(() => roles.slug, { onDelete: 'cascade' }),
    collection: text('collection').notNull().default('*'), // '*' or a slug (scoped assignment)
  },
  (t) => [
    index('principal_roles_principal_idx').on(t.principalId),
    uniqueIndex('principal_roles_unique').on(t.principalId, t.role, t.collection),
  ],
);

export const itemGrants = sqliteTable(
  'item_grants',
  {
    id: text('id').primaryKey(), // grn_…
    subjectKind: text('subject_kind').notNull(), // 'principal' | 'role'
    subjectId: text('subject_id').notNull(), // principal id or role slug
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    actionsJson: text('actions_json').notNull(), // string[] of actions granted
    grantedBy: text('granted_by').notNull(),
    expiresAt: text('expires_at'), // null = no expiry
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('item_grants_document_idx').on(t.documentId)],
);

// ---------------------------------------------------------------------------
// Invite tokens — single-use, expiring set-password links for invited humans.
// Only the SHA-256 hash is stored (never the plaintext), mirroring api_tokens.
// The token IS the credential: consuming one sets the invitee's password.
// ---------------------------------------------------------------------------

export const inviteTokens = sqliteTable(
  'invite_tokens',
  {
    id: text('id').primaryKey(), // inv_…
    principalId: text('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(), // SHA-256 hex — never plaintext
    purpose: text('purpose').notNull().default('set_password'), // extensible
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'), // null until used (single-use)
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('invite_tokens_hash_unique').on(t.tokenHash),
    index('invite_tokens_principal_idx').on(t.principalId),
  ],
);

// ---------------------------------------------------------------------------
// Media — R2 object metadata; rides the schema engine as a protected collection
// ---------------------------------------------------------------------------

export const media = sqliteTable(
  'media',
  {
    id: text('id').primaryKey(), // med_…
    r2Key: text('r2_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(), // sniffed, never the client-declared type
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    duration: real('duration'),
    alt: text('alt'),
    variantsJson: text('variants_json'), // reserved for derived assets (D11)
    createdBy: text('created_by').references(() => principals.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('media_r2_key_unique').on(t.r2Key)],
);
