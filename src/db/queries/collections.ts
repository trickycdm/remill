/**
 * Collection-definition queries. The only Drizzle importer for the `collections`
 * table; row↔domain mapping (fields_json / workflow_json / access_json parse) is
 * private here (steering/DATABASE_STANDARDS.md).
 *
 * Reads take no Grant — a collection definition is metadata needed to render every
 * surface. Mutations require a Grant witness (manage_schema), minted by
 * authorize() in the collections service.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { collections } from '@/db/schema';
import { documentFts } from '@/db/fts-table';
import { eventInsert, type EventInput } from '@/db/queries/events';
import type { CollectionDefinition, FieldDescriptor } from '@/fields/types';
import type { Grant } from '@/access/grant';

type Row = typeof collections.$inferSelect;

function toDomain(row: Row): CollectionDefinition {
  return {
    slug: row.slug,
    name: row.name,
    shape: row.shape as CollectionDefinition['shape'],
    fields: JSON.parse(row.fieldsJson || '[]') as FieldDescriptor[],
    workflow: row.workflowJson ? JSON.parse(row.workflowJson) : undefined,
    access: row.accessJson ? JSON.parse(row.accessJson) : undefined,
    renderMode: (row.renderMode as CollectionDefinition['renderMode']) ?? undefined,
    template: row.template ?? undefined,
    bind: row.bindJson ? (JSON.parse(row.bindJson) as CollectionDefinition['bind']) : undefined,
    protected: row.protected === 1,
  };
}

export async function listCollections(db: Database): Promise<CollectionDefinition[]> {
  const rows = await db.select().from(collections).orderBy(collections.slug);
  return rows.map(toDomain);
}

export async function getCollection(
  db: Database,
  slug: string,
): Promise<CollectionDefinition | null> {
  const rows = await db.select().from(collections).where(eq(collections.slug, slug)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function insertCollection(
  db: Database,
  def: CollectionDefinition,
  now: string,
  _grant: Grant,
  event?: EventInput,
): Promise<void> {
  const insert = db.insert(collections).values({
    slug: def.slug,
    name: def.name,
    shape: def.shape,
    fieldsJson: JSON.stringify(def.fields),
    workflowJson: def.workflow ? JSON.stringify(def.workflow) : null,
    accessJson: def.access ? JSON.stringify(def.access) : null,
    renderMode: def.renderMode ?? null,
    template: def.template ?? null,
    bindJson: def.bind ? JSON.stringify(def.bind) : null,
    protected: def.protected ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  // Outbox event (D33) rides the same atomic batch as the row it describes.
  if (event) await db.batch([insert, eventInsert(db, event)]);
  else await insert;
}

export async function updateCollectionRow(
  db: Database,
  slug: string,
  def: CollectionDefinition,
  now: string,
  _grant: Grant,
  event?: EventInput,
): Promise<void> {
  const update = db
    .update(collections)
    .set({
      name: def.name,
      shape: def.shape,
      fieldsJson: JSON.stringify(def.fields),
      workflowJson: def.workflow ? JSON.stringify(def.workflow) : null,
      accessJson: def.access ? JSON.stringify(def.access) : null,
      renderMode: def.renderMode ?? null,
      template: def.template ?? null,
      bindJson: def.bind ? JSON.stringify(def.bind) : null,
      updatedAt: now,
    })
    .where(eq(collections.slug, slug));
  if (event) await db.batch([update, eventInsert(db, event)]);
  else await update;
}

export async function deleteCollectionRow(
  db: Database,
  slug: string,
  _grant: Grant,
  event?: EventInput,
): Promise<void> {
  // Documents/index/revisions cascade via FK; the FTS virtual table has no FK,
  // so its rows for the collection are cleared in the same batch (D28).
  await db.batch([
    db.delete(collections).where(eq(collections.slug, slug)),
    db.delete(documentFts).where(eq(documentFts.collection, slug)),
    ...(event ? [eventInsert(db, event)] : []),
  ]);
}
