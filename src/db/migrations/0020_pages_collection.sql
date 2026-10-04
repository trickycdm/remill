-- D62: the built-in `pages` collection for installs that already exist.
-- Production deploys apply migrations but never re-run seed.sql, so the row
-- ships here as well as in the seed (0017 is the precedent) — KEEP THE TWO IN
-- STEP. Guarded on the seeded `settings` row: a database that has only had
-- migrations applied (a fresh install mid-setup, the unit-test harness) gets
-- the row from the seed instead. INSERT OR IGNORE leaves a collection someone
-- already created at this slug untouched.
INSERT OR IGNORE INTO collections (slug, name, shape, fields_json, workflow_json, access_json, protected, render_mode, created_at, updated_at)
SELECT
  'pages',
  'Pages',
  'collection',
  '[{"key":"title","type":"text","required":true,"index":true,"label":"Title","admin":{"showInList":true}},{"key":"html","type":"html","required":true,"label":"HTML","admin":{"help":"The whole page: a complete HTML document. It is shown in a sandboxed frame, so it can carry its own styles and scripts."}},{"key":"description","type":"text","label":"Description","admin":{"showInList":true,"help":"One or two sentences on what this page is."}},{"key":"tags","type":"tags","index":true,"label":"Tags"}]',
  '{"lifecycle":"none"}',
  '{"publicRead":true,"defaultVisibility":"private"}',
  1,
  'frame',
  '2026-10-04T00:00:00Z',
  '2026-10-04T00:00:00Z'
WHERE EXISTS (SELECT 1 FROM collections WHERE slug = 'settings');
