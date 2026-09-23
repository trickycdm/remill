/**
 * Document visibility (D50) — public/unlisted/private, separate from
 * draft/published. The single source for the union and the pure predicates
 * built on it, so the shape isn't re-declared per layer (queries, services,
 * routes, components) with the risk of drifting. `src/db/queries/documents.ts`
 * re-exports `VISIBILITIES`/`Visibility` from here so existing importers keep
 * working unchanged; routes and components should prefer importing the TYPE
 * from here (or from the documents service) rather than the queries layer.
 * See steering/ACCESS_CONTROL.md for how each value affects anonymous reads.
 */

export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The minimal document shape these predicates read. */
export interface VisibilityDoc {
  readonly visibility?: Visibility;
}

/** True when a document appears on public LISTING surfaces (index pages,
 *  RSS, sitemap, search, backlinks) — `public` only. `unlisted` is reachable
 *  by direct link but never listed; `private` isn't anonymously readable at
 *  all. A missing visibility is treated as public (unchanged legacy
 *  behaviour, predating D50). */
export function isListed(doc: VisibilityDoc): boolean {
  return (doc.visibility ?? 'public') === 'public';
}

/** The minimal collection-definition shape `isAnonymouslyReadable` reads. */
export interface VisibilityDef {
  readonly access?: { readonly publicRead?: boolean };
}

/** The minimal document shape `isAnonymouslyReadable` reads. */
export interface ReadableDoc extends VisibilityDoc {
  readonly status: 'draft' | 'published';
}

/** True when an anonymous reader can reach this document right now: the
 *  collection allows public read, the document is published, and its
 *  visibility isn't `private`. (`unlisted` still counts — reachable by its
 *  `doc_…` URL, just not listed; see `isListed`.) */
export function isAnonymouslyReadable(def: VisibilityDef, doc: ReadableDoc): boolean {
  return (
    def.access?.publicRead === true &&
    doc.status === 'published' &&
    (doc.visibility ?? 'public') !== 'private'
  );
}
