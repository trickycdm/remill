-- remill seed — idempotent (fixed IDs + INSERT OR IGNORE). Safe to re-run.
-- Applied locally by `bun run db:seed`, remotely by `bun run db:seed:remote`,
-- and by CI after migrations. See steering/DATABASE_STANDARDS.md.
--
-- Seeds: the first admin (principal + user), and the two protected dogfooding
-- collections `settings` (singleton) and `media`. The field `type`s referenced
-- in fields_json are implemented by the schema engine in Phase 2 — seeding the
-- definitions now is intentional (the engine reads them).

-- ---------------------------------------------------------------------------
-- First admin principal + credentials
-- Default dev login: admin@remill.local / remilladmin  — CHANGE IN PRODUCTION.
-- (Rotate with: bun run scripts/hash-password.ts '<new>' then update this row.)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO principals (id, kind, name, disabled, created_at)
VALUES ('prn_admin0000000000000', 'user', 'Administrator', 0, '2026-07-04T00:00:00Z');

INSERT OR IGNORE INTO users (principal_id, email, password_hash, created_at)
VALUES (
  'prn_admin0000000000000',
  'admin@remill.local',
  'cc81123b2cb4b87287c00c60e550a5ff:7e267b470e881c47d10871b587cb208899275378b065d00729241c440c585f9b',
  '2026-07-04T00:00:00Z'
);

-- ---------------------------------------------------------------------------
-- System roles + permissions (mirrors src/access/policy.ts — keep in sync).
-- Default-deny, additive-only: every row GRANTS. condition NULL | 'own' | 'published'.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO roles (slug, name, description, system, created_at) VALUES
  ('admin',     'Administrator', 'Full control over content, schema, and access.', 1, '2026-07-04T00:00:00Z'),
  ('editor',    'Editor',        'Create, edit, publish, and delete any content. No schema or access management.', 1, '2026-07-04T00:00:00Z'),
  ('author',    'Author',        'Create content and edit their own drafts. Cannot publish or delete.', 1, '2026-07-04T00:00:00Z'),
  ('reader',    'Reader',        'Read published content only.', 1, '2026-07-04T00:00:00Z'),
  ('anonymous', 'Anonymous',     'Unauthenticated access. Reads published content only where publicRead is enabled.', 1, '2026-07-04T00:00:00Z');

INSERT OR IGNORE INTO role_permissions (id, role, collection, action, condition) VALUES
  ('rlp_admin_read',    'admin', '*', 'read',           NULL),
  ('rlp_admin_create',  'admin', '*', 'create',         NULL),
  ('rlp_admin_update',  'admin', '*', 'update',         NULL),
  ('rlp_admin_delete',  'admin', '*', 'delete',         NULL),
  ('rlp_admin_publish', 'admin', '*', 'publish',        NULL),
  ('rlp_admin_schema',  'admin', '*', 'manage_schema',  NULL),
  ('rlp_admin_access',  'admin', '*', 'manage_access',  NULL),
  ('rlp_editor_read',   'editor', '*', 'read',    NULL),
  ('rlp_editor_create', 'editor', '*', 'create',  NULL),
  ('rlp_editor_update', 'editor', '*', 'update',  NULL),
  ('rlp_editor_delete', 'editor', '*', 'delete',  NULL),
  ('rlp_editor_publish','editor', '*', 'publish', NULL),
  ('rlp_author_create', 'author', '*', 'create', NULL),
  ('rlp_author_readpub','author', '*', 'read',   'published'),
  ('rlp_author_readown','author', '*', 'read',   'own'),
  ('rlp_author_updown', 'author', '*', 'update', 'own'),
  ('rlp_reader_readpub','reader', '*', 'read',   'published');

-- Grant the first admin the admin role, install-wide.
INSERT OR IGNORE INTO principal_roles (id, principal_id, role, collection)
VALUES ('pnr_admin0000000000000', 'prn_admin0000000000000', 'admin', '*');

-- ---------------------------------------------------------------------------
-- `settings` — singleton, protected. Site-wide configuration.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO collections (slug, name, shape, fields_json, workflow_json, access_json, protected, created_at, updated_at)
VALUES (
  'settings',
  'Settings',
  'singleton',
  '[{"key":"siteName","type":"text","required":true,"admin":{"showInList":true}},{"key":"siteDescription","type":"text"},{"key":"defaultAuthorName","type":"text"}]',
  NULL,
  NULL,
  1,
  '2026-07-04T00:00:00Z',
  '2026-07-04T00:00:00Z'
);

-- ---------------------------------------------------------------------------
-- `media` — collection, protected. Editable metadata for uploaded assets;
-- binary + system metadata (r2_key, mime, size, dimensions) live in the `media`
-- table. The upload/media field type lands in Phase 5.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO collections (slug, name, shape, fields_json, workflow_json, access_json, protected, created_at, updated_at)
VALUES (
  'media',
  'Media',
  'collection',
  '[{"key":"alt","type":"text","admin":{"showInList":true}},{"key":"caption","type":"text"}]',
  NULL,
  '{"publicRead":true}',
  1,
  '2026-07-04T00:00:00Z',
  '2026-07-04T00:00:00Z'
);
