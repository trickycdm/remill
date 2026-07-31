/**
 * Drizzle handle for the FTS5 virtual table `document_fts` (migration 0007,
 * D28). DELIBERATELY NOT in src/db/schema.ts: drizzle-kit diffs that file and
 * would emit spurious DDL for a virtual table — migration 0007 owns the DDL.
 * This handle exists so FTS writes are PREPARED statements: the D1 driver can
 * only batch prepared queries (a raw `db.run(sql)` throws inside `db.batch`),
 * and every FTS write must ride the document write's atomic batch.
 *
 * MATCH/snippet()/bm25() reads stay raw SQL (src/db/queries/search.ts) — they
 * are FTS5-specific syntax Drizzle cannot express, and reads run outside
 * batches where raw execution is supported.
 */

import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const documentFts = sqliteTable('document_fts', {
  documentId: text('document_id'),
  collection: text('collection'),
  title: text('title'),
  body: text('body'),
});
