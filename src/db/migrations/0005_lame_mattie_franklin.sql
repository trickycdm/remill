CREATE TABLE `invite_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text DEFAULT 'set_password' NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_tokens_hash_unique` ON `invite_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invite_tokens_principal_idx` ON `invite_tokens` (`principal_id`);