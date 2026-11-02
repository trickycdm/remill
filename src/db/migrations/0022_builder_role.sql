-- D64: the `builder` system role — editor + manage_schema, no manage_access —
-- so an OAuth-connected agent (the consent screen never offers admin) can be
-- allowed to define its own collections. Production deploys apply migrations
-- but never re-run seed.sql, so existing installs get the role here (same fixed
-- ids as seed.sql, INSERT OR IGNORE). On a fresh database the system roles
-- don't exist yet (seed.sql creates them, with these rows), hence the guard.
-- KEEP IN STEP with SYSTEM_ROLES (src/access/policy.ts) and seed.sql. One
-- statement per row: D1 caps compound SELECTs, so no UNION ALL table.
INSERT OR IGNORE INTO `roles` (`slug`, `name`, `description`, `system`, `created_at`)
  SELECT 'builder', 'Builder', 'Everything an editor can do, plus create and change collections. No access management.', 1, '2026-11-02T00:00:00Z'
  WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'admin');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_read', 'builder', '*', 'read', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_create', 'builder', '*', 'create', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_update', 'builder', '*', 'update', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_delete', 'builder', '*', 'delete', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_publish', 'builder', '*', 'publish', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_sharelink', 'builder', '*', 'share_link', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_comment', 'builder', '*', 'comment', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_builder_schema', 'builder', '*', 'manage_schema', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'builder');
