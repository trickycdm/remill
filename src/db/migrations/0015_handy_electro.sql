ALTER TABLE `document_trash` ADD `visibility` text DEFAULT 'public' NOT NULL CHECK (`visibility` IN ('public','unlisted','private'));--> statement-breakpoint
ALTER TABLE `documents` ADD `visibility` text DEFAULT 'public' NOT NULL CHECK (`visibility` IN ('public','unlisted','private'));--> statement-breakpoint
ALTER TABLE `item_grants` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `item_grants` ADD `label` text;