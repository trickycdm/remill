CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports_json` text,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkeys_principal_idx` ON `passkeys` (`principal_id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`challenge` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL CHECK (`purpose` IN ('register', 'authenticate')),
	`principal_id` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
