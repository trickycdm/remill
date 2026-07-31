/**
 * Full-text search query (D28). Joins `document_fts` (the FTS5 virtual table,
 * migration 0007) to `documents` so each caller's COMPILED read predicate applies
 * in-query per collection — never post-filter (D17). The MATCH expression must
 * come from `toFtsQuery` (src/lib/fts.ts); raw user input is never matched.
 *
 * Requires one Grant per searched collection: the service read-authorizes every
 * collection it includes in `scopes` (witness discipline, ACCESS_CONTROL.md).
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { documents } from '@/db/schema';
import type { Grant } from '@/access/grant';

export interface SearchScope {
  readonly collection: string;
  /** Compiled read predicate for this collection (undefined = unrestricted). */
  readonly accessFilter?: SQL;
}

export interface SearchHit {
  readonly id: string;
  readonly collection: string;
  readonly title: string | null;
  /** snippet() output with char(1)/char(2) sentinels around matches — render via
   *  snippetToHtml (src/lib/fts.ts) or strip for plain-text surfaces. */
  readonly snippet: string;
  readonly status: 'draft' | 'published';
  readonly updatedAt: string;
}

interface RawHit {
  readonly id: string;
  readonly collection: string;
  readonly title: string | null;
  readonly snippet: string;
  readonly status: string;
  readonly updated_at: string;
}

/**
 * Rank-ordered (bm25; title weighted 5× over body) search across the given
 * scopes. Offset pagination only — relevance order has no keyset. Fetches
 * `limit + 1` rows so the caller can detect a further page.
 */
export async function searchDocuments(
  db: Database,
  opts: {
    readonly match: string;
    readonly scopes: readonly SearchScope[];
    readonly limit: number;
    readonly offset: number;
  },
  _grants: readonly Grant[],
): Promise<{ hits: SearchHit[]; hasMore: boolean }> {
  if (!opts.scopes.length) return { hits: [], hasMore: false };

  const scopeClauses = opts.scopes.map((s) =>
    s.accessFilter
      ? sql`(document_fts.collection = ${s.collection} AND (${s.accessFilter}))`
      : sql`(document_fts.collection = ${s.collection})`,
  );

  const rows = await db.all<RawHit>(sql`
    SELECT ${documents.id} AS id,
           document_fts.collection AS collection,
           document_fts.title AS title,
           snippet(document_fts, 3, char(1), char(2), '…', 12) AS snippet,
           ${documents.status} AS status,
           ${documents.updatedAt} AS updated_at
    FROM document_fts
    JOIN ${documents} ON ${documents.id} = document_fts.document_id
    WHERE document_fts MATCH ${opts.match}
      AND (${sql.join(scopeClauses, sql` OR `)})
    ORDER BY bm25(document_fts, 0, 0, 5.0, 1.0)
    LIMIT ${opts.limit + 1} OFFSET ${opts.offset}
  `);

  const hasMore = rows.length > opts.limit;
  const hits = rows.slice(0, opts.limit).map((r) => ({
    id: r.id,
    collection: r.collection,
    title: r.title || null,
    snippet: r.snippet,
    status: r.status as 'draft' | 'published',
    updatedAt: r.updated_at,
  }));
  return { hits, hasMore };
}
