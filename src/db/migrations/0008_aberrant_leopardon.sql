CREATE TABLE `document_trash` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`collection` text NOT NULL,
	`data_json` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('draft', 'published')),
	`revisions_json` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	`deleted_by` text,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_trash_document_unique` ON `document_trash` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_trash_deleted_at_idx` ON `document_trash` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `document_trash_collection_idx` ON `document_trash` (`collection`);