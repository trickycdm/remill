-- D63: widen the `render_mode` CHECK to admit 'inline' (the document renders in
-- place inside the viewer shell, no iframe), and move the built-in `pages`
-- collection (D62) to it.
--
-- HAND-WRITTEN column swap, like 0019 and for the same reason: `documents`
-- cascades from `collections`, so the parent table is never rebuilt.
ALTER TABLE `collections` ADD `render_mode_v3` text CHECK (`render_mode_v3` IN ('shell','raw','frame','inline'));
--> statement-breakpoint
UPDATE `collections` SET `render_mode_v3` = `render_mode`;
--> statement-breakpoint
ALTER TABLE `collections` DROP COLUMN `render_mode`;
--> statement-breakpoint
ALTER TABLE `collections` RENAME COLUMN `render_mode_v3` TO `render_mode`;
--> statement-breakpoint
-- Only the protected, built-in row still in frame mode: a user's own `pages`
-- collection, or one already switched elsewhere, is left alone. KEEP IN STEP
-- with the pages row in seed.sql (compared by seed.test.ts).
UPDATE `collections`
SET `render_mode` = 'inline',
    `fields_json` = replace(`fields_json`,
      'It is shown in a sandboxed frame, so it can carry its own styles and scripts.',
      'It is shown in place inside the viewer, with its own styles and scripts.')
WHERE `slug` = 'pages' AND `protected` = 1 AND `render_mode` = 'frame';
