CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope_json` text,
	`expires_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_principal_idx` ON `api_tokens` (`principal_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`shape` text DEFAULT 'collection' NOT NULL CHECK (`shape` IN ('collection', 'singleton')),
	`fields_json` text DEFAULT '[]' NOT NULL,
	`workflow_json` text,
	`access_json` text,
	`protected` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_index` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`collection` text NOT NULL,
	`field_key` text NOT NULL,
	`value_text` text,
	`value_num` real,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_index_doc_idx` ON `document_index` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_index_text_idx` ON `document_index` (`collection`,`field_key`,`value_text`);--> statement-breakpoint
CREATE INDEX `document_index_num_idx` ON `document_index` (`collection`,`field_key`,`value_num`);--> statement-breakpoint
CREATE TABLE `document_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`revision` integer NOT NULL,
	`data_json` text NOT NULL,
	`saved_by` text,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_by`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_revisions_doc_rev_unique` ON `document_revisions` (`document_id`,`revision`);--> statement-breakpoint
CREATE INDEX `document_revisions_doc_idx` ON `document_revisions` (`document_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`collection` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL CHECK (`status` IN ('draft', 'published')),
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`collection`) REFERENCES `collections`(`slug`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_collection_idx` ON `documents` (`collection`);--> statement-breakpoint
CREATE INDEX `documents_collection_status_idx` ON `documents` (`collection`,`status`);--> statement-breakpoint
CREATE INDEX `documents_created_by_idx` ON `documents` (`created_by`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration` real,
	`alt` text,
	`variants_json` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_r2_key_unique` ON `media` (`r2_key`);--> statement-breakpoint
CREATE TABLE `principals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('user', 'agent')),
	`name` text NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`principal_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);