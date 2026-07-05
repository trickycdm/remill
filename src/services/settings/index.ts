/**
 * Settings service — reads the site-wide configuration held in the `settings`
 * singleton (schema-as-data; SCHEMA_ENGINE.md). One reader, `getSettings`, projects
 * the singleton's raw `data` into a typed `SiteSettings` with sensible defaults.
 *
 * UN-GATED READ (deliberate exception to the authorize()/Grant discipline):
 * site configuration is a *rendering* concern read on many requests (list page
 * size, timestamp formatting, the masthead) — often for principals who cannot read
 * arbitrary documents. Like `collectionPublicRead`/collection metadata, it therefore
 * reads through a witness-free query (`getSingletonData`) rather than the gated
 * document pipeline. It exposes only these non-sensitive display fields — never
 * document content — so no principal is required. WRITES to settings still run the
 * full authorize()-gated document save pipeline via the settings route.
 */

import type { Database } from '@/db/client';
import { getSingletonData } from '@/db/queries/documents';

/** The site configuration surfaced to render paths. Every field is optional — the
 *  singleton may be unsaved or partially filled — so callers apply their own
 *  fallbacks (e.g. `settings.defaultPageSize ?? DEFAULT_PAGE_SIZE`). */
export interface SiteSettings {
  readonly siteName?: string;
  readonly siteDescription?: string;
  readonly siteUrl?: string;
  readonly defaultAuthorName?: string;
  readonly timezone?: string;
  readonly dateFormat?: string;
  readonly defaultPageSize?: number;
  readonly logo?: string;
}

/** Coerce a raw JSON value to a trimmed non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** Read the site settings from the `settings` singleton. Never throws for a
 *  missing/unsaved singleton — it returns an all-undefined object so callers always
 *  get a stable shape. */
export async function getSettings(db: Database): Promise<SiteSettings> {
  const data = (await getSingletonData(db, 'settings')) ?? {};
  const pageSize = typeof data.defaultPageSize === 'number' ? data.defaultPageSize : undefined;
  return {
    siteName: str(data.siteName),
    siteDescription: str(data.siteDescription),
    siteUrl: str(data.siteUrl),
    defaultAuthorName: str(data.defaultAuthorName),
    timezone: str(data.timezone),
    dateFormat: str(data.dateFormat),
    defaultPageSize: pageSize,
    logo: str(data.logo),
  };
}
