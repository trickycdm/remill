CREATE TABLE `item_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`document_id` text NOT NULL,
	`actions_json` text NOT NULL,
	`granted_by` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_grants_document_idx` ON `item_grants` (`document_id`);--> statement-breakpoint
CREATE TABLE `principal_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`role` text NOT NULL,
	`collection` text DEFAULT '*' NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role`) REFERENCES `roles`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `principal_roles_principal_idx` ON `principal_roles` (`principal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `principal_roles_unique` ON `principal_roles` (`principal_id`,`role`,`collection`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`collection` text NOT NULL,
	`action` text NOT NULL,
	`condition` text,
	FOREIGN KEY (`role`) REFERENCES `roles`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `role_permissions_role_idx` ON `role_permissions` (`role`);--> statement-breakpoint
CREATE TABLE `roles` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`system` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
