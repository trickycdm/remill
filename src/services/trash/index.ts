/**
 * Trash service (D29) — recoverable delete. The documents service's
 * `deleteDocument` snapshots into `document_trash`; this module owns listing,
 * restore, permanent deletion, and the retention purge.
 *
 * Access model: **`delete` on the collection gates the whole trash surface** —
 * who can delete can see and undelete (symmetric, no new action). Listing is
 * pre-scoped via `collectionsWithAction` (no deny-audit spray), then each
 * included collection is delete-authorized for its Grant. Restore is a DIRECT
 * query re-insert under the original id — not the create pipeline — so
 * definition drift can never make a document unrecoverable; the index/FTS rows
 * are recomputed against the CURRENT definition (data keys no longer declared
 * simply aren't indexed, and drop on the next save per COR-5).
 */

import type { Database } from '@/db/client';
import { authorize, type Principal } from '@/access';
import type { Grant } from '@/access/grant';
import { collectionsWithAction, getPrincipalPermissions } from '@/services/access';
import { getCollection } from '@/db/queries/collections';
import * as tq from '@/db/queries/trash';
import { buildIndex, buildSearchText } from '@/services/documents';
import { TRASH_RETENTION_DAYS, DAY_MS } from '@/config/retention';
import { NotFoundError, ConflictError } from '@/lib/errors';

export type { TrashRecord, TrashRevision } from '@/db/queries/trash';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface ListTrashResult {
  readonly rows: tq.TrashRecord[];
  readonly limit: number;
  readonly offset: number;
}

/** The caller's delete-permission conditions for one collection, mirrored into
 *  the trash query's scope shape: undefined = an unconditional grant exists;
 *  else the OR of own/published — so an `own`-conditioned author sees exactly
 *  the trash they could have deleted, never someone else's (D17 in-query). */
function deleteScopeFor(
  perms: readonly { collection: string; action: string; condition: string | null }[],
  principal: Principal,
  collection: string,
): tq.TrashScope {
  const matching = perms.filter(
    (p) => p.action === 'delete' && (p.collection === '*' || p.collection === collection),
  );
  if (matching.some((p) => p.condition == null)) return { collection };
  return {
    collection,
    conditions: {
      ownBy: matching.some((p) => p.condition === 'own') ? principal.id : undefined,
      publishedOnly: matching.some((p) => p.condition === 'published') ? true : undefined,
    },
  };
}

/** Trash rows the principal may act on: collections-with-trash ∩ collections
 *  the principal can `delete` (each one delete-authorized), narrowed by the
 *  caller's own/published conditions in-query. */
export async function listTrash(
  db: Database,
  principal: Principal,
  params: { readonly limit?: number; readonly offset?: number },
  now: string,
): Promise<ListTrashResult> {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit ?? DEFAULT_PAGE_SIZE));
  const offset = Math.max(0, params.offset ?? 0);

  const deletable = await collectionsWithAction(db, principal, 'delete');
  const present = await tq.trashedCollections(db);
  const visible = deletable === '*' ? present : present.filter((c) => deletable.includes(c));
  if (!visible.length) return { rows: [], limit, offset };

  const perms = await getPrincipalPermissions(db, principal.id);
  const grants: Grant[] = [];
  const scopes: tq.TrashScope[] = [];
  for (const collection of visible) {
    grants.push(await authorize(db, principal, 'delete', { collection }, now));
    scopes.push(deleteScopeFor(perms, principal, collection));
  }
  const rows = await tq.listTrash(db, { scopes, limit, offset }, grants);
  return { rows, limit, offset };
}

/** Restore a trashed document under its ORIGINAL id. 409 when the collection
 *  definition is gone, when the id was re-created meanwhile, or when a unique
 *  field value has been re-taken. */
export async function restoreDocument(
  db: Database,
  principal: Principal,
  trashId: string,
  now: string,
): Promise<{ documentId: string; collection: string }> {
  // Metadata first — the collection is needed to authorize (no content flows).
  const meta = await tq.getTrashMeta(db, trashId);
  if (!meta) throw new NotFoundError('Trash entry');
  // A collection-level grant reads the snapshot; the ITEM decision below carries
  // the snapshot's status/creator so own/published conditions evaluate exactly
  // as they would have against the live document.
  const readBack = await authorize(db, principal, 'delete', { collection: meta.collection }, now);
  const record = await tq.getTrashRecord(db, trashId, readBack);
  if (!record) throw new NotFoundError('Trash entry');
  const grant = await authorize(
    db,
    principal,
    'delete',
    {
      collection: record.collection,
      documentId: record.documentId,
      status: record.status,
      createdBy: record.createdBy ?? undefined,
    },
    now,
  );

  const def = await getCollection(db, record.collection);
  if (!def) {
    throw new ConflictError(
      `Collection '${record.collection}' no longer exists — recreate it to restore this document.`,
    );
  }

  try {
    await tq.restoreTrashedDocument(
      db,
      {
        trashId,
        documentId: record.documentId,
        collection: record.collection,
        data: record.data,
        status: record.status,
        revisions: record.revisions,
        createdBy: record.createdBy,
        createdAt: record.createdAt,
        updatedAt: now,
        publishedAt: record.publishedAt,
        index: buildIndex(def, record.data),
        search: buildSearchText(def, record.data),
        event: {
          type: 'document.restored',
          collection: record.collection,
          resource: record.documentId,
          principalId: principal.id,
          at: now,
        },
      },
      grant,
    );
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(e.message)) {
      throw new ConflictError(
        'Cannot restore: the document id or a unique field value has been taken since deletion.',
      );
    }
    throw e;
  }
  return { documentId: record.documentId, collection: record.collection };
}

/** Permanently delete one trash entry ("delete forever"). Gated by `delete`. */
export async function deleteForever(
  db: Database,
  principal: Principal,
  trashId: string,
  now: string,
): Promise<void> {
  const meta = await tq.getTrashMeta(db, trashId);
  if (!meta) throw new NotFoundError('Trash entry');
  const readBack = await authorize(db, principal, 'delete', { collection: meta.collection }, now);
  const record = await tq.getTrashRecord(db, trashId, readBack);
  if (!record) throw new NotFoundError('Trash entry');
  const grant = await authorize(
    db,
    principal,
    'delete',
    {
      collection: record.collection,
      documentId: record.documentId,
      status: record.status,
      createdBy: record.createdBy ?? undefined,
    },
    now,
  );
  await tq.deleteTrashRow(db, trashId, grant);
}

/** Daily-cron retention purge (D31): drop entries older than
 *  TRASH_RETENTION_DAYS. Witness-free maintenance — no principal exists in a
 *  cron invocation and retention is not an authorization decision. */
export async function purgeExpiredTrash(db: Database, now: string): Promise<number> {
  const cutoff = new Date(new Date(now).getTime() - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
  const purged = await tq.purgeExpiredTrashRows(db, cutoff);
  if (purged > 0) console.log(`[cron] purged ${purged} expired trash entr${purged === 1 ? 'y' : 'ies'}`);
  return purged;
}
