CREATE TABLE `team_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text DEFAULT 'reader' NOT NULL,
	`max_uses` integer CHECK (`max_uses` IS NULL OR `max_uses` > 0),
	`use_count` integer DEFAULT 0 NOT NULL CHECK (`use_count` >= 0),
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role`) REFERENCES `roles`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invites_hash_unique` ON `team_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `team_invites_team_idx` ON `team_invites` (`team_id`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`added_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_unique` ON `team_members` (`team_id`,`principal_id`);--> statement-breakpoint
CREATE INDEX `team_members_principal_idx` ON `team_members` (`principal_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `collections` ADD `render_mode` text CHECK (`render_mode` IN ('shell','raw'));