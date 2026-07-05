/**
 * Audit log queries. Append-only — there is deliberately no update or delete
 * function here (steering/ACCESS_CONTROL.md). Only the access module writes audit
 * rows, via authorize().
 */

import { desc } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { auditLog } from '@/db/schema';
import { newId } from '@/lib/id';

export interface AuditEntry {
  readonly principalId: string;
  readonly tokenId?: string;
  readonly surface: string;
  readonly action: string;
  readonly resource: string;
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
    allowed: e.allowed ? 1 : 0,
    createdAt: e.now,
  });
}

/** Read recent audit rows (newest first). Requires manage_access at the service
 *  layer — this query does not authorize. */
export async function recentAudit(db: Database, limit = 100) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}
