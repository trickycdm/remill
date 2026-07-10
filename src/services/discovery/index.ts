/**
 * Public discovery reads (D35) — the data behind /rss.xml, /sitemap.xml, and
 * the `/` homepage. Everything here reads AS THE ANONYMOUS PRINCIPAL through
 * the same gated list pipeline as the public pages: only published documents
 * of publicRead + lifecycle collections ever surface, enforced in-query by the
 * compiled read filter — this module adds selection and shaping, never access
 * logic of its own.
 */

import type { Database } from '@/db/client';
import type { CollectionDefinition } from '@/fields/types';
import { anonymousPrincipal } from '@/access';
import { listCollections } from '@/services/collections';
import { listDocuments, buildSearchText, type ExpandedDocument } from '@/services/documents';
import { titleOf, publicUrlOf, excerptFrom } from '@/lib/def-helpers';
import { hasLifecycle } from '@/lib/lifecycle';
import { NotFoundError } from '@/lib/errors';

/** One feed/sitemap/homepage entry — pre-extracted strings, ready for the pure
 *  builders in src/lib/feeds.ts. `path` is relative; callers prepend the base
 *  URL where absolute links are required (RSS/sitemap). */
export interface DiscoveryDoc {
  readonly id: string;
  readonly collection: string;
  readonly title: string;
  readonly path: string;
  readonly excerpt: string;
  readonly publishedAt: string | null;
  readonly updatedAt: string;
}

/** RSS merged-feed size (D35). */
export const FEED_LIMIT = 50;
/** sitemap.xml document cap (D35). */
export const SITEMAP_CAP = 5000;

/** The collections the public surface advertises: publicRead (the opt-in) AND
 *  a lifecycle (lifecycle:'none' data collections are records, not pages). */
export async function publicCollections(db: Database): Promise<CollectionDefinition[]> {
  const defs = await listCollections(db);
  return defs.filter((d) => d.access?.publicRead === true && hasLifecycle(d));
}

function toDiscoveryDoc(def: CollectionDefinition, doc: ExpandedDocument): DiscoveryDoc {
  const body = buildSearchText(def, doc.data)?.body ?? '';
  return {
    id: doc.id,
    collection: def.slug,
    title: titleOf(def, doc),
    path: publicUrlOf(def, doc, ''),
    excerpt: excerptFrom(body),
    publishedAt: doc.publishedAt,
    updatedAt: doc.updatedAt,
  };
}

async function publishedDocs(
  db: Database,
  def: CollectionDefinition,
  now: string,
  cap: number,
): Promise<DiscoveryDoc[]> {
  const anon = anonymousPrincipal('rest');
  const out: DiscoveryDoc[] = [];
  let cursor: string | undefined;
  do {
    const page = await listDocuments(
      db,
      anon,
      def.slug,
      { status: 'published', pageSize: Math.min(100, cap - out.length), cursor },
      now,
    );
    out.push(...page.rows.map((d) => toDiscoveryDoc(def, d)));
    cursor = page.nextCursor;
  } while (cursor && out.length < cap);
  return out;
}

/** Resolve + validate a `?collection=` narrowing — 404 (indistinguishable from
 *  a missing collection) when it isn't publicly advertised. */
async function narrowTo(db: Database, slug: string): Promise<CollectionDefinition[]> {
  const eligible = await publicCollections(db);
  const def = eligible.find((d) => d.slug === slug);
  if (!def) throw new NotFoundError('Collection');
  return [def];
}

/** The merged recent-published feed (RSS), newest publishedAt first. Fetches a
 *  bounded window per collection (recency-ordered by the default sort), then
 *  orders the MERGED set by publishedAt — presentation ordering only; access
 *  filtering already happened in-query. */
export async function recentPublishedDocs(
  db: Database,
  now: string,
  opts: { readonly collection?: string; readonly limit?: number } = {},
): Promise<DiscoveryDoc[]> {
  const limit = opts.limit ?? FEED_LIMIT;
  const defs = opts.collection ? await narrowTo(db, opts.collection) : await publicCollections(db);
  const perCollection = await Promise.all(defs.map((def) => publishedDocs(db, def, now, limit)));
  return perCollection
    .flat()
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, limit);
}

/** Every published public document (sitemap), capped at SITEMAP_CAP. */
export async function allPublishedDocs(db: Database, now: string): Promise<DiscoveryDoc[]> {
  const defs = await publicCollections(db);
  const out: DiscoveryDoc[] = [];
  for (const def of defs) {
    if (out.length >= SITEMAP_CAP) break;
    out.push(...(await publishedDocs(db, def, now, SITEMAP_CAP - out.length)));
  }
  return out;
}

/** /:collection index page cap (v1: one bounded page, newest first). */
export const INDEX_CAP = 100;

/** One public collection + its published docs, newest publishedAt first — the
 *  data behind the public `/:collection` index page. Throws NotFoundError for
 *  a collection that isn't publicly advertised (the route renders the same
 *  indistinguishable 404 as a missing one). */
export async function collectionIndex(
  db: Database,
  now: string,
  slug: string,
  cap = INDEX_CAP,
): Promise<{ def: CollectionDefinition; docs: DiscoveryDoc[] }> {
  const [def] = await narrowTo(db, slug);
  const docs = (await publishedDocs(db, def, now, cap)).sort((a, b) =>
    (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
  );
  return { def, docs };
}

/** The homepage shape: each public collection with its recent published docs. */
export async function publicOverview(
  db: Database,
  now: string,
  perCollection = 5,
): Promise<{ def: CollectionDefinition; docs: DiscoveryDoc[] }[]> {
  const defs = await publicCollections(db);
  return Promise.all(
    defs.map(async (def) => ({ def, docs: await publishedDocs(db, def, now, perCollection) })),
  );
}
