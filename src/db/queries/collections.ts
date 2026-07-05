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
): Promise<void> {
  await db.insert(collections).values({
    slug: def.slug,
    name: def.name,
    shape: def.shape,
    fieldsJson: JSON.stringify(def.fields),
    workflowJson: def.workflow ? JSON.stringify(def.workflow) : null,
    accessJson: def.access ? JSON.stringify(def.access) : null,
    protected: def.protected ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateCollectionRow(
  db: Database,
  slug: string,
  def: CollectionDefinition,
  now: string,
  _grant: Grant,
): Promise<void> {
  await db
    .update(collections)
    .set({
      name: def.name,
      shape: def.shape,
      fieldsJson: JSON.stringify(def.fields),
      workflowJson: def.workflow ? JSON.stringify(def.workflow) : null,
      accessJson: def.access ? JSON.stringify(def.access) : null,
      updatedAt: now,
    })
    .where(eq(collections.slug, slug));
}

export async function deleteCollectionRow(
  db: Database,
  slug: string,
  _grant: Grant,
): Promise<void> {
  await db.delete(collections).where(eq(collections.slug, slug));
}
