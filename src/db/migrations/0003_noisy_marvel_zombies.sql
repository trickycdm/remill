ALTER TABLE `document_index` ADD `unique_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `document_index_unique_text` ON `document_index` (`unique_key`,`value_text`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_index_unique_num` ON `document_index` (`unique_key`,`value_num`);