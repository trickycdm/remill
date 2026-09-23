CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`thread_id` text,
	`author_kind` text NOT NULL CHECK (`author_kind` IN ('principal','reviewer')),
	`author_principal_id` text,
	`reviewer_id` text,
	`author_name` text NOT NULL,
	`visibility` text CHECK (`visibility` IS NULL OR `visibility` IN ('internal','shared')),
	`anchor_json` text,
	`anchor_revision` integer,
	`anchor_status` text CHECK (`anchor_status` IS NULL OR `anchor_status` IN ('anchored','outdated')),
	`body` text NOT NULL,
	`intent` text CHECK (`intent` IS NULL OR `intent` IN ('must_fix','question','suggestion','nit','praise')),
	`status` text CHECK (`status` IS NULL OR `status` IN ('open','resolved')),
	`resolved_by` text,
	`resolved_revision` integer,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `review_reviewers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `comments_document_idx` ON `comments` (`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_thread_idx` ON `comments` (`thread_id`);--> statement-breakpoint
CREATE TABLE `review_reviewers` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`document_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`kind` text NOT NULL CHECK (`kind` IN ('invited','self_named')),
	`done_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `item_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_reviewers_grant_idx` ON `review_reviewers` (`grant_id`);--> statement-breakpoint
CREATE INDEX `review_reviewers_document_idx` ON `review_reviewers` (`document_id`);--> statement-breakpoint
ALTER TABLE `item_grants` ADD `review_mode` text CHECK (`review_mode` IS NULL OR `review_mode` IN ('group','individual'));--> statement-breakpoint
-- D55: the `comment` action for the system roles. Production deploys apply
-- migrations but never re-run seed.sql, so existing installs get the rows here
-- (same fixed ids as seed.sql, INSERT OR IGNORE). On a fresh database the roles
-- don't exist yet (seed.sql creates them, with these rows), hence the guard.
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_admin_comment', 'admin', '*', 'comment', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'admin');--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_editor_comment', 'editor', '*', 'comment', NULL WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'editor');--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`id`, `role`, `collection`, `action`, `condition`)
  SELECT 'rlp_author_commentown', 'author', '*', 'comment', 'own' WHERE EXISTS (SELECT 1 FROM `roles` WHERE `slug` = 'author');
