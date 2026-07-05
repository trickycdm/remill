CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`token_id` text,
	`surface` text NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`allowed` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_principal_idx` ON `audit_log` (`principal_id`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);