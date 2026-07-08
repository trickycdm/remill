ALTER TABLE `documents` ADD `publish_at` text;--> statement-breakpoint
-- Scheduled publishing (D32). Partial index hand-added (drizzle-kit cannot
-- express WHERE-indexes): the per-minute drain scans only pending schedules,
-- and almost every document has publish_at NULL.
CREATE INDEX `documents_publish_at_idx` ON `documents` (`publish_at`) WHERE `publish_at` IS NOT NULL;
