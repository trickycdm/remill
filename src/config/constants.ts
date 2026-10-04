/**
 * Shared constants. Never inline a magic number twice — put it here
 * (CODING_CONVENTIONS.md).
 */

/** Session cookie lifetime (seconds). Mirrors sessionSetup's expireAfterSeconds. */
export const SESSION_TTL_SECONDS = 86_400; // 24h

/** Default page size for admin/REST list views. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** localStorage key the theme toggle persists to (mirrored in the design system). */
export const THEME_STORAGE_KEY = 'remill-theme';

/** Reserved collection slugs — seeded, protected, cannot be user-deleted. */
export const PROTECTED_COLLECTIONS = ['settings', 'media', 'pages'] as const;

/** The built-in collection of standalone HTML pages (D62) — what `publish_page`
 *  writes to and the admin's Pages section lists. */
export const PAGES_COLLECTION = 'pages';

/** Slugs whose GENERATED tool names would shadow a static MCP tool — a
 *  collection `page` would generate `publish_page`. Refused on create only. */
export const TOOL_RESERVED_COLLECTION_SLUGS = ['page'] as const;

/** URL-reserved collection slugs (C2): the router's static top-level path
 *  segments — a collection named one of these would be shadowed by them on the
 *  public `/:collection/:slug` surface. (`media`/`settings` need no entry: the
 *  seeded collections already hold those slugs, so the uniqueness check covers
 *  them.) `s` is the share-link namespace (C3); `frame` serves framed-page
 *  content (D60); `assets`/`src`/`vendor` are build/static paths. */
export const RESERVED_COLLECTION_SLUGS = ['admin', 'api', 'assets', 'auth', 'frame', 'mcp', 's', 'src', 'vendor'] as const;

/** Rough chars-per-token heuristic for text-render budgets (D47) — an
 *  approximation shared by every surface that accepts a `budget` arg. */
export const APPROX_CHARS_PER_TOKEN = 4;

/** Reserved document-field keys the engine owns; a collection field may not use them. */
export const RESERVED_FIELD_KEYS = [
  'id',
  'status',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'publishAt', // scheduled publishing (D32)
  'createdBy',
] as const;
