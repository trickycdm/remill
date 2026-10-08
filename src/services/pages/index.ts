/**
 * Pages (D62) — publish a standalone HTML page in one call. Sugar over the
 * documents service for the built-in `pages` collection: it fills the title
 * from the document itself, optionally mints a share (or review) link in the
 * same call, and reports what the page will refuse to load. It adds
 * NO rule of its own — authorization, validation, revisions and the size
 * limit are `createDocument` / `updateDocument` / `mintApiShareLink`, exactly
 * as `create_pages` and `share_link_pages` would apply them.
 *
 * ONE implementation behind the MCP `publish_page` tool and REST `/api/pages`.
 */

import type { Database } from '@/db/client';
import type { Principal } from '@/access';
import { PAGES_COLLECTION } from '@/config/constants';
import { getCollection } from '@/services/collections';
import { createDocument, updateDocument, parseExpectedRevision } from '@/services/documents';
import { mintApiShareLink, type ApiShareLink } from '@/services/sharing';
import { analyzeFramedHtml } from '@/lib/frame/analyze';
import { analyzePageHtml } from '@/lib/inline/analyze';
import { pageFieldOf } from '@/lib/page-field';
import { titleFieldOf } from '@/lib/def-helpers';
import { InputValidationError, NotFoundError } from '@/lib/errors';
import type { CollectionDefinition } from '@/fields/types';

export const UNTITLED_PAGE = 'Untitled page';

/** The raw request values — validated here, once, for REST and MCP alike. */
export interface PublishPageInput {
  readonly html?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly tags?: unknown;
  /** Present ⇒ update that page (the same URL keeps working); absent ⇒ create. */
  readonly id?: unknown;
  /** With `id`: refuse the save if the page has moved on (D54). */
  readonly expectedRevision?: unknown;
  /** Present ⇒ also mint a link: `{ expiresAt, password?, label?, review? }`. */
  readonly share?: unknown;
}

export interface PublishedPage {
  readonly id: string;
  /** The page in its viewer — for someone signed in who may read it. */
  readonly url: string;
  readonly title: string;
  readonly revision: number;
  readonly visibility: string;
  readonly share: (Omit<ApiShareLink, 'token'> & { readonly url: string }) | null;
  /** What the page will refuse to load or run. Advisory. */
  readonly warnings: readonly string[];
}

/** The built-in pages collection, or null when this install has repurposed or
 *  removed it (a user's own `pages` collection that isn't a page-mode one —
 *  inline, D63, or framed, D60). */
export async function getPagesCollection(db: Database): Promise<CollectionDefinition | null> {
  const def = await getCollection(db, PAGES_COLLECTION);
  return def && isPageMode(def.renderMode) && pageFieldOf(def) && titleFieldOf(def) ? def : null;
}

/** The render modes in which the page field IS a page the viewer shows. */
export function isPageMode(mode: CollectionDefinition['renderMode']): boolean {
  return mode === 'inline' || mode === 'frame';
}

const optionalText = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

export async function publishPage(
  db: Database,
  principal: Principal,
  input: PublishPageInput,
  ctx: { readonly secret: string; readonly baseUrl: string },
  now: string,
): Promise<PublishedPage> {
  const def = await getPagesCollection(db);
  if (!def) throw new NotFoundError('The pages collection');
  const htmlKey = pageFieldOf(def)!;
  const titleKey = titleFieldOf(def)!;
  const declares = (key: string) => def.fields.some((f) => f.key === key);

  if (typeof input.html !== 'string' || !input.html.trim()) {
    throw new InputValidationError([
      { path: 'html', message: 'html is required: the full HTML document to publish.' },
    ]);
  }
  if (input.id !== undefined && typeof input.id !== 'string') {
    throw new InputValidationError([{ path: 'id', message: 'id must be a page id.' }]);
  }
  const report = def.renderMode === 'inline' ? analyzePageHtml(input.html) : analyzeFramedHtml(input.html);
  const title = optionalText(input.title);

  // Only what the caller sent (and the collection declares): an update is a
  // PATCH, so an omitted title or description keeps its stored value.
  const data: Record<string, unknown> = { [htmlKey]: input.html };
  if (input.description !== undefined && declares('description'))
    data.description = input.description;
  if (input.tags !== undefined && declares('tags')) data.tags = input.tags;

  const doc = input.id
    ? await updateDocument(
        db,
        principal,
        def.slug,
        input.id,
        { ...data, ...(title ? { [titleKey]: title } : {}) },
        now,
        {
          expectedRevision: parseExpectedRevision(input.expectedRevision),
        },
      )
    : await createDocument(
        db,
        principal,
        def.slug,
        { ...data, [titleKey]: title ?? report.title ?? UNTITLED_PAGE },
        now,
      );

  let share: PublishedPage['share'] = null;
  if (input.share !== undefined && input.share !== null && input.share !== false) {
    const wanted = (typeof input.share === 'object' ? input.share : {}) as Record<string, unknown>;
    const { token, ...link } = await mintApiShareLink(
      db,
      principal,
      {
        collection: def.slug,
        documentId: doc.id,
        expiresAt: wanted.expiresAt,
        password: wanted.password,
        label: wanted.label,
        review: wanted.review,
      },
      ctx.secret,
      now,
    );
    share = { ...link, url: `${ctx.baseUrl}/s/${token}` };
  }

  return {
    id: doc.id,
    url: `${ctx.baseUrl}/admin/c/${def.slug}/${doc.id}/view`,
    title: String(doc.data[titleKey] ?? ''),
    revision: doc.revision,
    visibility: doc.visibility,
    share,
    warnings: report.warnings,
  };
}
