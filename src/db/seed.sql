-- remill seed — SYSTEM DATA ONLY. Idempotent (fixed IDs + INSERT OR IGNORE).
-- Applied locally by `bun run db:seed`, remotely by `bun run db:seed:remote`,
-- and by CI after migrations. See steering/DATABASE_STANDARDS.md.
--
-- Seeds the system roles/permissions and the two protected dogfooding collections
-- `settings` (singleton) and `media`. The field `type`s referenced in fields_json
-- are implemented by the schema engine (the engine reads these definitions).
--
-- SECURITY (C1): this file NO LONGER provisions an admin login. Shipping a known
-- password hash in the repo — and pushing it to production via `db:seed:remote` —
-- was a critical hole (any freshly-seeded prod instance had publicly-known admin
-- credentials). The first admin is now created out of band, with an explicit
-- generated/operator-chosen password, by `scripts/bootstrap-admin.ts`
-- (`bun run db:bootstrap:local` / `db:bootstrap:remote`). This seed is therefore
-- safe to run against production: it contains no credentials.

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
  ('rlp_admin_sharelink','admin', '*', 'share_link',     NULL),
  ('rlp_admin_comment', 'admin', '*', 'comment',        NULL),
  ('rlp_editor_read',   'editor', '*', 'read',    NULL),
  ('rlp_editor_create', 'editor', '*', 'create',  NULL),
  ('rlp_editor_update', 'editor', '*', 'update',  NULL),
  ('rlp_editor_delete', 'editor', '*', 'delete',  NULL),
  ('rlp_editor_publish','editor', '*', 'publish', NULL),
  ('rlp_editor_sharelink','editor', '*', 'share_link', NULL),
  ('rlp_editor_comment', 'editor', '*', 'comment',    NULL),
  ('rlp_author_create', 'author', '*', 'create', NULL),
  ('rlp_author_readpub','author', '*', 'read',   'published'),
  ('rlp_author_readown','author', '*', 'read',   'own'),
  ('rlp_author_updown', 'author', '*', 'update', 'own'),
  ('rlp_author_commentown', 'author', '*', 'comment', 'own'),
  ('rlp_reader_readpub','reader', '*', 'read',   'published');

-- ---------------------------------------------------------------------------
-- `settings` — singleton, protected. Site-wide configuration.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO collections (slug, name, shape, fields_json, workflow_json, access_json, protected, created_at, updated_at)
VALUES (
  'settings',
  'Settings',
  'singleton',
  '[{"key":"siteName","type":"text","required":true,"label":"Site name","admin":{"showInList":true}},{"key":"siteDescription","type":"text","label":"Site description"},{"key":"siteUrl","type":"text","label":"Site URL"},{"key":"emailFrom","type":"text","label":"Email from address","admin":{"help":"Verified sender for outgoing mail (share links, invites), e.g. bot@colmack.com. Overrides the EMAIL_FROM environment variable."}},{"key":"allowCdnScripts","type":"boolean","label":"Allow CDN scripts on public pages","admin":{"help":"WARNING: lets published HTML pages load scripts from cdn.jsdelivr.net and unpkg.com. This weakens the public-page CSP - leave OFF unless a page needs an external library. Admin pages are unaffected."}},{"key":"defaultAuthorName","type":"text","label":"Default author name","admin":{"help":"Optional byline convention for authored content; irrelevant for record-like data."}},{"key":"timezone","type":"text","label":"Timezone","admin":{"placeholder":"UTC","help":"IANA name, e.g. UTC or America/New_York."}},{"key":"dateFormat","type":"select","label":"Date format","config":{"options":[{"value":"iso","label":"2026-07-05"},{"value":"long","label":"July 5, 2026"},{"value":"short","label":"Jul 5, 2026"}]}},{"key":"defaultPageSize","type":"number","label":"Default list page size"},{"key":"logo","type":"media","label":"Logo","admin":{"help":"Upload in the Media library, then paste its id."}}]',
  NULL,
  NULL,
  1,
  '2026-07-04T00:00:00Z',
  '2026-07-04T00:00:00Z'
);


-- Existing installs: INSERT OR IGNORE leaves an existing settings row untouched,
-- so new settings FIELDS are appended here idempotently (guarded by a LIKE probe).
UPDATE collections SET fields_json = json_insert(fields_json, '$[#]', json('{"key":"emailFrom","type":"text","label":"Email from address","admin":{"help":"Verified sender for outgoing mail (share links, invites), e.g. bot@colmack.com. Overrides the EMAIL_FROM environment variable."}}'))
WHERE slug = 'settings' AND fields_json NOT LIKE '%"emailFrom"%';
UPDATE collections SET fields_json = json_insert(fields_json, '$[#]', json('{"key":"allowCdnScripts","type":"boolean","label":"Allow CDN scripts on public pages","admin":{"help":"WARNING: lets published HTML pages load scripts from cdn.jsdelivr.net and unpkg.com. This weakens the public-page CSP - leave OFF unless a page needs an external library. Admin pages are unaffected."}}'))
WHERE slug = 'settings' AND fields_json NOT LIKE '%"allowCdnScripts"%';

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
