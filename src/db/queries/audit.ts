/**
 * Audit log queries. Append-only — there is deliberately no update or delete
 * function here (steering/ACCESS_CONTROL.md). Only the access module writes audit
 * rows, via authorize().
 */

import { and, eq, desc, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { auditLog } from '@/db/schema';
import { newId } from '@/lib/id';

export interface AuditEntry {
  readonly principalId: string;
  readonly tokenId?: string;
  readonly surface: string;
  readonly action: string;
  readonly resource: string;
  /** The resource's collection — denormalized for the activity filters. */
  readonly collection?: string;
  readonly allowed: boolean;
  readonly now: string;
}

/** Append one audit row (allow or deny). */
export async function appendAudit(db: Database, e: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    id: newId('audit'),
    principalId: e.principalId,
    tokenId: e.tokenId ?? null,
    surface: e.surface,
    action: e.action,
    resource: e.resource,
    collection: e.collection ?? null,
    allowed: e.allowed ? 1 : 0,
    createdAt: e.now,
  });
}

/** Read recent audit rows (newest first). Requires manage_access at the service
 *  layer — this query does not authorize. */
export async function recentAudit(db: Database, limit = 100) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

export interface AuditFilters {
  readonly principalId?: string;
  readonly action?: string;
  readonly collection?: string;
  readonly allowed?: boolean;
  readonly surface?: string;
}

/** Keyset position for audit paging (createdAt DESC, id DESC). */
export interface AuditCursor {
  readonly createdAt: string;
  readonly id: string;
}

/** Filtered, keyset-paginated audit page (newest first). Fetches `limit + 1`
 *  rows so the caller can emit a next-cursor. Requires manage_access at the
 *  service layer — this query does not authorize. */
export async function listAuditPage(
  db: Database,
  opts: { readonly filters?: AuditFilters; readonly cursor?: AuditCursor; readonly limit: number },
) {
  const f = opts.filters ?? {};
  const where: (SQL | undefined)[] = [
    f.principalId ? eq(auditLog.principalId, f.principalId) : undefined,
    f.action ? eq(auditLog.action, f.action) : undefined,
    f.collection ? eq(auditLog.collection, f.collection) : undefined,
    f.allowed !== undefined ? eq(auditLog.allowed, f.allowed ? 1 : 0) : undefined,
    f.surface ? eq(auditLog.surface, f.surface) : undefined,
    opts.cursor
      ? sql`(${auditLog.createdAt} < ${opts.cursor.createdAt} OR (${auditLog.createdAt} = ${opts.cursor.createdAt} AND ${auditLog.id} < ${opts.cursor.id}))`
      : undefined,
  ];
  return db
    .select()
    .from(auditLog)
    .where(and(...where))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(opts.limit + 1);
}
