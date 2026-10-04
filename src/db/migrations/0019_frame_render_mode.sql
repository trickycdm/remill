-- D60: widen the `render_mode` CHECK to admit 'frame' (the document renders in
-- a sandboxed iframe inside the viewer shell).
--
-- HAND-WRITTEN, and deliberately NOT a table rebuild: `documents.collection`
-- cascades from `collections`, D1 cannot switch foreign keys off, and dropping
-- the parent table would delete every document. The CHECK is a column
-- constraint (0006), so swapping the column widens it without touching a row.
ALTER TABLE `collections` ADD `render_mode_v2` text CHECK (`render_mode_v2` IN ('shell','raw','frame'));
--> statement-breakpoint
UPDATE `collections` SET `render_mode_v2` = `render_mode`;
--> statement-breakpoint
ALTER TABLE `collections` DROP COLUMN `render_mode`;
--> statement-breakpoint
ALTER TABLE `collections` RENAME COLUMN `render_mode_v2` TO `render_mode`;
