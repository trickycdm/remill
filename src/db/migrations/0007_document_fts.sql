-- Custom migration: full-text search (D28).
--
-- `document_fts` is a PLAIN FTS5 virtual table (not contentless/external-content):
-- plain tables support ordinary INSERT/DELETE with no trigger machinery, and the
-- text duplication is irrelevant at this platform's scale. It is deliberately kept
-- OUT of src/db/schema.ts — drizzle-kit diffs that file and would emit spurious DDL
-- for a virtual table — so this migration is the table's single source of truth
-- (same raw-only treatment as the hand-added CHECK constraints).
--
-- Rows are synced inside the SAME atomic db.batch() as every document write
-- (src/db/queries/documents.ts). FK cascades cannot clear a virtual table, so the
-- delete path removes the row explicitly.
--
-- POST-DEPLOY: this table starts EMPTY for pre-existing documents. Run the
-- "Rebuild search index" action on /admin/settings once after applying.
CREATE VIRTUAL TABLE `document_fts` USING fts5(
	`document_id` UNINDEXED,
	`collection` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
