CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris_json` text NOT NULL,
	`token_endpoint_auth_method` text DEFAULT 'none' NOT NULL CHECK (`token_endpoint_auth_method` = 'none'),
	`metadata_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`grant_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text DEFAULT 'S256' NOT NULL CHECK (`code_challenge_method` = 'S256'),
	`resource` text,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_codes_hash_unique` ON `oauth_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `oauth_codes_grant_idx` ON `oauth_codes` (`grant_id`);--> statement-breakpoint
CREATE TABLE `oauth_device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code_hash` text NOT NULL,
	`user_code_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text,
	`grant_id` text,
	`denied_at` text,
	`last_polled_at` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_device_hash_unique` ON `oauth_device_codes` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_device_user_unique` ON `oauth_device_codes` (`user_code_hash`);--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`granted_by` text NOT NULL,
	`role` text NOT NULL,
	`resource` text,
	`refresh_token_hash` text,
	`prev_refresh_token_hash` text,
	`refresh_expires_at` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_client_unique` ON `oauth_grants` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_refresh_unique` ON `oauth_grants` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grants_principal_idx` ON `oauth_grants` (`principal_id`);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `grant_id` text REFERENCES oauth_grants(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `api_tokens_grant_idx` ON `api_tokens` (`grant_id`);