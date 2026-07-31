ALTER TABLE `principals` ADD `subtype` text;--> statement-breakpoint
-- Backfill the persona subtype for existing rows (display/grouping only; not
-- security-relevant). Machines read as 'agent', humans as 'person'. New rows set
-- subtype explicitly at the service layer (createUser → 'person', createAgent →
-- 'service' | 'agent'); no DB CHECK (SQLite can't add one without a table rebuild).
UPDATE `principals` SET `subtype` = 'agent' WHERE `kind` = 'agent' AND `subtype` IS NULL;--> statement-breakpoint
UPDATE `principals` SET `subtype` = 'person' WHERE `kind` = 'user' AND `subtype` IS NULL;
