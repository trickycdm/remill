/**
 * Import/export + site snapshot (D37). NDJSON, one collection per file:
 * line 1 is the header `{kind:'remill-export', version:1, exportedAt,
 * collection: <full def>}`, then one `{kind:'document', …}` per line.
 *
 * - EXPORT is bounded by the caller's compiled read filter (via the gated list
 *   pipeline): you export exactly what you can read — own drafts included when
 *   visible, other people's never.
 * - IMPORT upserts by preserved id through the FULL validated pipeline with
 *   per-item authorize (create/update); lines carrying `status:'published'`
 *   additionally require the `publish` action (import must not be a publish
 *   bypass — "agent drafts, human publishes" survives bulk ingestion). Errors
 *   are per-line; a run never aborts, and `dryRun` writes nothing.
 * - SNAPSHOT writes every collection (all docs — the caller is an operator
 *   whose read filter is unrestricted) + media METADATA to R2 under
 *   `snapshots/<ISO>/`; binaries stay in their own R2 keys.
 */

import type { Database } from '@/db/client';
import type { Principal } from '@/access';
import { authorize } from '@/access';
import type { CollectionDefinition } from '@/fields/types';
import { getCollection, listCollections } from '@/db/queries/collections';
import { getDocumentCollection } from '@/db/queries/documents';
import { listMedia as listMediaRows } from '@/db/queries/media';
import * as docs from '@/services/documents';
import { toNdjson, parseNdjson } from '@/lib/ndjson';
import { hasLifecycle } from '@/lib/lifecycle';
import { BadRequestError, NotFoundError, ForbiddenError, InputValidationError, AppError } from '@/lib/errors';

const EXPORT_KIND = 'remill-export';
const EXPORT_VERSION = 1;
/** Page size for export sweeps (MAX_PAGE_SIZE-clamped by the list service). */
const EXPORT_PAGE = 100;

interface DocumentLine {
  readonly kind: 'document';
  readonly id: string;
  readonly status: 'draft' | 'published';
  readonly data: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportResult {
  readonly ndjson: string;
  readonly count: number;
}

/** Export a collection as NDJSON — read-authorized and read-FILTERED (the
 *  gated list pipeline applies the caller's compiled filter in-query). */
export async function exportCollection(
  db: Database,
  principal: Principal,
  slug: string,
  now: string,
): Promise<ExportResult> {
  const def = await getCollection(db, slug);
  if (!def) throw new NotFoundError('Collection');

  const lines: unknown[] = [
    { kind: EXPORT_KIND, version: EXPORT_VERSION, exportedAt: now, collection: def },
  ];
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await docs.listDocuments(db, principal, slug, { pageSize: EXPORT_PAGE, cursor }, now);
    for (const row of page.rows) {
      const line: DocumentLine = {
        kind: 'document',
        id: row.id,
        status: row.status,
        data: row.data, // raw ids, never the `relations` expansion
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        publishedAt: row.publishedAt,
        createdBy: row.createdBy,
      };
      lines.push(line);
      count++;
    }
    cursor = page.nextCursor;
  } while (cursor);
  return { ndjson: toNdjson(lines), count };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportError {
  readonly line: number;
  readonly id?: string;
  readonly error: string;
}

export interface ImportResult {
  readonly created: number;
  readonly updated: number;
  readonly failed: number;
  readonly errors: ImportError[];
  readonly dryRun: boolean;
}

function messageOf(e: unknown): string {
  // Per-line reports need the field-level detail, not the generic envelope.
  if (e instanceof InputValidationError) {
    const issues = (e.details ?? []) as { path?: string; message?: string }[];
    const detail = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : (i.message ?? ''))).filter(Boolean);
    return detail.length ? detail.join('; ') : e.friendlyMessage;
  }
  if (e instanceof AppError) return e.friendlyMessage;
  return e instanceof Error ? e.message : String(e);
}

/** Shape-check one parsed line into a document-line candidate (throws
 *  BadRequestError with a per-line-friendly message). */
function asDocumentLine(value: unknown): Partial<DocumentLine> & { data: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) throw new BadRequestError('Not an object.');
  const v = value as Record<string, unknown>;
  if (v.kind !== 'document') throw new BadRequestError("Expected kind 'document'.");
  if (typeof v.data !== 'object' || v.data === null || Array.isArray(v.data)) {
    throw new BadRequestError("'data' must be an object.");
  }
  if (v.id !== undefined && typeof v.id !== 'string') throw new BadRequestError("'id' must be a string.");
  if (v.status !== undefined && v.status !== 'draft' && v.status !== 'published') {
    throw new BadRequestError("'status' must be 'draft' or 'published'.");
  }
  return v as Partial<DocumentLine> & { data: Record<string, unknown> };
}

/**
 * Import NDJSON into `collection`. Upsert by id: an existing id updates, a new
 * (or absent) id creates — preserved ids must be `doc_…`-shaped. The header's
 * def slug must match the target; the definition is NEVER mutated by import.
 */
export async function importCollection(
  db: Database,
  principal: Principal,
  collection: string,
  text: string,
  now: string,
  opts: { readonly dryRun?: boolean } = {},
): Promise<ImportResult> {
  const def = await getCollection(db, collection);
  if (!def) throw new NotFoundError('Collection');

  const parsed = parseNdjson(text);
  if (!parsed.length) throw new BadRequestError('Empty import — expected an NDJSON export.');

  // Header line: right kind, right version, right target.
  const head = parsed[0];
  const header = (head.value ?? {}) as { kind?: unknown; version?: unknown; collection?: { slug?: unknown } };
  if (head.error || header.kind !== EXPORT_KIND) {
    throw new BadRequestError(`Line 1 must be the {kind:'${EXPORT_KIND}'} header.`);
  }
  if (header.version !== EXPORT_VERSION) {
    throw new BadRequestError(`Unsupported export version '${String(header.version)}' (expected ${EXPORT_VERSION}).`);
  }
  if (header.collection?.slug !== collection) {
    throw new BadRequestError(
      `This export is for '${String(header.collection?.slug)}' — import it into that collection, not '${collection}'.`,
    );
  }

  const dryRun = opts.dryRun === true;
  const errors: ImportError[] = [];
  let created = 0;
  let updated = 0;

  // Publish gate (SEC tightening beyond the plan): a line arriving with
  // status 'published' is a publish decision — authorize it ONCE per run so
  // import can't smuggle drafts live past "agent drafts, human publishes".
  const wantsPublished = parsed
    .slice(1)
    .some((l) => !l.error && (l.value as { status?: unknown } | null)?.status === 'published');
  let publishDenied: string | null = null;
  if (wantsPublished && hasLifecycle(def) && !dryRun) {
    try {
      await authorize(db, principal, 'publish', { collection }, now);
    } catch (e) {
      if (!(e instanceof ForbiddenError)) throw e;
      publishDenied = messageOf(e);
    }
  }

  for (const entry of parsed.slice(1)) {
    let id: string | undefined;
    try {
      if (entry.error) throw new BadRequestError(entry.error);
      const line = asDocumentLine(entry.value);
      id = line.id;
      // lifecycle-none collections are always published (B4); otherwise the
      // line's status (default draft) — publish-gated above.
      const status = !hasLifecycle(def) ? 'published' : (line.status ?? 'draft');
      if (status === 'published' && publishDenied !== null) throw new ForbiddenError(publishDenied, { action: 'publish', collection });

      const exists = id ? await isExistingDocument(db, collection, id) : false;
      if (dryRun) {
        // Validate the shape + field values only — no transforms, no writes.
        docs.whitelistAndValidate(def, line.data);
        if (exists) updated++;
        else created++;
        continue;
      }
      if (exists) {
        await docs.updateDocument(db, principal, collection, id!, line.data, now);
        updated++;
      } else {
        await docs.createDocument(db, principal, collection, line.data, now, {
          id,
          status,
          createdAt: typeof line.createdAt === 'string' ? line.createdAt : undefined,
          publishedAt: typeof line.publishedAt === 'string' ? line.publishedAt : undefined,
        });
        created++;
      }
    } catch (e) {
      errors.push({ line: entry.line, id, error: messageOf(e) });
    }
  }
  return { created, updated, failed: errors.length, errors, dryRun };
}

/** Existence check scoped to the target collection — metadata-only. */
async function isExistingDocument(db: Database, collection: string, id: string): Promise<boolean> {
  return (await getDocumentCollection(db, id)) === collection;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface SnapshotResult {
  readonly prefix: string;
  readonly collections: { slug: string; documents: number }[];
  readonly mediaCount: number;
}

/**
 * Full-site snapshot to R2 under `snapshots/<ISO>/`: every collection def +
 * ALL of its documents (the caller is an operator — gated `manage_schema` on
 * '*', the rebuild-search precedent — whose read filter is unrestricted) +
 * media METADATA (binaries stay at their own `media/` keys) + a manifest.
 * Cron wiring deliberately left out in v1 (hook point in src/jobs).
 */
export async function snapshotSite(
  db: Database,
  bucket: R2Bucket,
  principal: Principal,
  now: string,
): Promise<SnapshotResult> {
  await authorize(db, principal, 'manage_schema', { collection: '*' }, now);

  const prefix = `snapshots/${now}`;
  const collections: { slug: string; documents: number }[] = [];
  for (const def of await listCollections(db)) {
    const { ndjson, count } = await exportCollection(db, principal, def.slug, now);
    await bucket.put(`${prefix}/${def.slug}.ndjson`, ndjson);
    collections.push({ slug: def.slug, documents: count });
  }

  // Media metadata — one {kind:'media'} line per asset.
  const mediaLines: unknown[] = [];
  let cursor: string | null = null;
  do {
    const page = await listMediaRows(db, { limit: 100, cursor });
    mediaLines.push(...page.rows.map((m) => ({ kind: 'media', ...m })));
    cursor = page.nextCursor;
  } while (cursor);
  await bucket.put(`${prefix}/media.ndjson`, toNdjson(mediaLines));

  const manifest = {
    kind: 'remill-snapshot',
    version: EXPORT_VERSION,
    exportedAt: now,
    collections,
    media: mediaLines.length,
    note: 'Media binaries are excluded — metadata only. Originals live under the media/ prefix.',
  };
  await bucket.put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2));
  return { prefix, collections, mediaCount: mediaLines.length };
}

export type { CollectionDefinition };
