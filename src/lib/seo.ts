/**
 * Rich SEO head for the public reading surfaces (D52). Pure — no DB, no
 * services import beyond a type-only `SiteSettings` (the `format-date.ts`
 * precedent for a type-only services import from `src/lib/`). Shared by the
 * article route AND the `/s/:token` open-share-link render (plan Part 3), so
 * the two can't drift apart.
 *
 * Reuses `resolveConventionLayout` (`src/templates/lib/conventions.ts`) for
 * the lead/hero slots — the SAME resolver the reading templates use, called
 * with the resolved template's OWN `layoutOptions` (`templates/registry.ts`)
 * — so the head always agrees with what the page actually shows (honours
 * `bind.hero`/`bind.lead` and a template opting out of a hero/lead, not a
 * re-guessed heuristic).
 */

import type { CollectionDefinition } from '@/fields/types';
import type { SiteSettings } from '@/services/settings';
import type { PageHead } from '@/layouts';
import { titleOf, excerptFrom, isListed, type DocLike } from '@/lib/def-helpers';
import { resolveConventionLayout } from '@/templates/lib/conventions';
import { resolveTemplate } from '@/templates/registry';
import { isSeoFieldKey } from '@/lib/seo-keys';

/** Language used for `<html lang>` and `og:locale` — a language-only value
 *  (no region), matching `RootLayout`'s static `<html lang="en">`. remill has
 *  no locale/region setting to read, so this is a fixed, non-guessed default
 *  rather than an inferred `en_US`/`en_GB`. */
export const DEFAULT_LOCALE = 'en';

/** Media display metadata keyed by field key — structurally the same shape as
 *  `ExpandedDocument['media']` (`src/services/documents/index.ts`), passed
 *  through without importing the services layer. */
export interface SeoMediaMeta {
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

/** The document shape `buildDocumentHead` needs — a superset of `DocLike`
 *  (title/URL helpers) plus the lifecycle/visibility fields the head and
 *  robots/canonical rules read. */
export interface SeoDoc extends DocLike {
  readonly status: 'draft' | 'published';
  readonly publishedAt?: string | null;
  readonly updatedAt?: string | null;
}

export interface BuildDocumentHeadInput {
  readonly def: CollectionDefinition;
  readonly doc: SeoDoc;
  readonly settings: SiteSettings;
  /** Absolute origin, no trailing slash (`resolveBaseUrl`). */
  readonly baseUrl: string;
  /** The document's blessed canonical URL — only emitted as `<link
   *  rel=canonical>` when the document is published AND public. */
  readonly canonicalUrl: string;
  /** The URL the reader is actually on right now — always used for `og:url`,
   *  even when no canonical is emitted (e.g. the `doc_…` URL for an unlisted
   *  document, or a `/s/:token` share link). */
  readonly publicUrl: string;
  /** Pre-extracted body text (`buildSearchText(def, doc.data).body`) — the
   *  caller extracts it (services layer) so this module stays DB/layer-free. */
  readonly bodyText: string;
  /** Media display metadata for every media field that resolved, keyed by
   *  field key (`ExpandedDocument.media`). */
  readonly media?: Readonly<Record<string, SeoMediaMeta>>;
  /** False ⇒ `noindex` (unlisted, preview, or any `/s/` render). */
  readonly indexable: boolean;
  /** The reading-template key (`def.template`) — selects the JSON-LD `@type`. */
  readonly template?: string;
}

function fieldValue(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === 'string' && v.trim().length ? v : undefined;
}

/** Strip `undefined` values (shallow) so JSON-LD stays free of empty keys. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Serialise a value for a `<script type="application/ld+json">` block.
 * `JSON.stringify` handles quote/backslash escaping; `<`, `>` and `&` are
 * additionally escaped to their `\uXXXX` forms so no `</script>` (or `<!--`)
 * sequence can break out of the script context, and U+2028/U+2029 (valid JSON
 * whitespace, invalid raw JS) are escaped so the block never trips a strict
 * JS parser reading it as a script. `application/ld+json` is inert data (the
 * browser never executes it as JS), and the CSP's `script-src` already
 * carries `'unsafe-inline'` (`src/middleware/security-headers.ts`) for the
 * theme-init snippet, so this one inline block needs no separate CSP
 * allowance — confirmed, not assumed.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * Build the full `PageHead` for a document's public render. Used by the
 * article route (`/:collection/:slug`) and the open state of `/s/:token`.
 */
export function buildDocumentHead(input: BuildDocumentHeadInput): PageHead {
  const { def, doc, settings, baseUrl, canonicalUrl, publicUrl, bodyText, media, indexable, template } =
    input;
  const siteName = settings.siteName?.trim() || 'remill';
  // Resolved with the TEMPLATE's OWN layout options (`layoutOptions`,
  // `templates/registry.ts`) — a template that opts out of a hero/lead (docs,
  // changelog, prompt, warp, status) must not have the head guess one from an
  // arbitrary unclaimed field; undefined (no/unknown template) keeps the
  // default (article shape: wants both).
  const tpl = resolveTemplate(template);
  const layout = resolveConventionLayout(def, tpl?.layoutOptions);

  // Title: `seo_title` field (convention key, D52 — snake_case: field keys
  // are validated `^[a-z][a-z0-9_]*$`, see `src/services/collections/index.ts`)
  // → the title/OG heuristic shared with feeds and search (`titleOf` —
  // honours `bind.title`).
  const title = fieldValue(doc.data, 'seo_title') ?? titleOf(def, doc);
  const fullTitle = `${title} — ${siteName}`;

  // Description: `meta_description` field → the template's own lead/dek slot
  // (honours `bind.lead`, cut to excerpt length like the body fallback) → an
  // excerpt of the body text → the site default. Never the hardcoded layout
  // fallback string, and never `''` (an empty description is indistinguishable
  // from the `bare` "no description" signal — `layouts.tsx`).
  const leadRaw = layout.lead ? fieldValue(doc.data, layout.lead.key) : undefined;
  const leadExcerpt = leadRaw ? excerptFrom(leadRaw) : undefined;
  const bodyExcerpt = bodyText.trim().length ? excerptFrom(bodyText) : undefined;
  const description =
    fieldValue(doc.data, 'meta_description') ?? leadExcerpt ?? bodyExcerpt ?? settings.siteDescription ?? undefined;

  // Image: `social_image` field → the template's hero slot (honours
  // `bind.hero`) → the first (non-SEO-override) media field → the site logo.
  // Always absolute.
  const firstMediaField = def.fields.find((f) => f.type === 'media' && !isSeoFieldKey(f.key));
  const heroKey = layout.hero?.key;
  const imageFieldKey =
    fieldValue(doc.data, 'social_image') !== undefined
      ? 'social_image'
      : (heroKey && fieldValue(doc.data, heroKey) !== undefined
          ? heroKey
          : firstMediaField && fieldValue(doc.data, firstMediaField.key) !== undefined
            ? firstMediaField.key
            : undefined);
  const imageId = imageFieldKey ? doc.data[imageFieldKey] : undefined;
  const ogImage =
    typeof imageId === 'string' && imageId.length
      ? `${baseUrl}/media/${imageId}`
      : settings.logo
        ? `${baseUrl}/media/${settings.logo}`
        : undefined;
  const imageMeta = imageFieldKey ? media?.[imageFieldKey] : undefined;

  // Dates.
  const publishedTime = doc.publishedAt ?? undefined;
  const modifiedTime = doc.updatedAt ?? undefined;

  // Author: no byline convention exists in the reading templates today (D52
  // decision) — the site default author is the only source.
  const author = settings.defaultAuthorName;

  // Tags: the first `tags`-type field.
  const tagsField = def.fields.find((f) => f.type === 'tags');
  const rawTags = tagsField ? doc.data[tagsField.key] : undefined;
  const tags = Array.isArray(rawTags) ? rawTags.filter((t): t is string => typeof t === 'string') : undefined;

  // Canonical: only when published AND public — unlisted/private/preview/
  // share-link renders never leak the slug URL as canonical, even though
  // `og:url` still points at wherever the reader actually is.
  const canonical = doc.status === 'published' && isListed(doc) ? canonicalUrl : undefined;

  const jsonLd = compact({
    '@context': 'https://schema.org',
    '@type': template === 'article' ? 'BlogPosting' : 'Article',
    headline: title,
    description: description || undefined,
    image: ogImage ? [ogImage] : undefined,
    datePublished: publishedTime,
    dateModified: modifiedTime,
    author: author ? compact({ '@type': 'Person', name: author }) : undefined,
    publisher: compact({
      '@type': 'Organization',
      name: siteName,
      logo: settings.logo
        ? compact({ '@type': 'ImageObject', url: `${baseUrl}/media/${settings.logo}` })
        : undefined,
    }),
    mainEntityOfPage: canonical ? compact({ '@type': 'WebPage', '@id': canonical }) : undefined,
  });

  return {
    title: fullTitle,
    description,
    canonical,
    ogUrl: publicUrl,
    ogTitle: title,
    ogType: 'article',
    ogImage,
    imageAlt: imageMeta?.alt ?? undefined,
    imageWidth: imageMeta?.width ?? undefined,
    imageHeight: imageMeta?.height ?? undefined,
    siteName,
    locale: DEFAULT_LOCALE,
    publishedTime,
    modifiedTime,
    author,
    tags,
    jsonLd,
    feedUrl: '/rss.xml',
    noindex: indexable ? undefined : true,
  };
}
