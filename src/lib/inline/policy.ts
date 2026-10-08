/**
 * The inline-page policy (D63) — what an inline page may load once it renders
 * inside remill's own page. ONE module owns the allowlists so the response
 * header (`PAGE_CSP_SOURCES`, applied by the security-headers middleware) and
 * the publish-time warnings (`pageAllows`) can never disagree.
 *
 * The page runs on remill's origin, so the isolation the frame gave (D60) is
 * gone by design: the author is trusted (D25/D63). The widening here is about
 * RESOURCES only — the same library CDNs, Google Fonts and any-https images a
 * framed page could use — on top of the site policy. `connect-src`,
 * `frame-ancestors` and `X-Frame-Options` stay as strict as the rest of the
 * site.
 */

/** Library CDNs an inline page may load scripts, styles and fonts from. Exact
 *  hosts only — never wildcards. */
export const PAGE_CDN_HOSTS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
] as const;

export const PAGE_FONT_STYLE_HOST = 'https://fonts.googleapis.com';
export const PAGE_FONT_FILE_HOST = 'https://fonts.gstatic.com';

/** The extra CSP sources an inline page's response gets, per directive. */
export const PAGE_CSP_SOURCES = {
  scriptSrc: [...PAGE_CDN_HOSTS],
  styleSrc: [...PAGE_CDN_HOSTS, PAGE_FONT_STYLE_HOST],
  fontSrc: [...PAGE_CDN_HOSTS, PAGE_FONT_FILE_HOST, 'data:'],
  imgSrc: ['https:', 'blob:'],
  mediaSrc: ["'self'", 'data:', 'blob:'],
} as const;

export type PageResourceKind = 'script' | 'style' | 'font' | 'image';

/**
 * Whether an inline page may load `raw` (a URL as written in the page:
 * absolute, protocol-relative, or site-relative) as `kind` — the same
 * allowlists the header emits, read the other way.
 */
export function pageAllows(kind: PageResourceKind, raw: string): boolean {
  const value = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1].toLowerCase();
  if (scheme === 'data') return kind === 'image' || kind === 'font';
  if (scheme === 'blob') return kind === 'image';
  // Site-relative: served by remill itself ('self').
  if (!scheme && !value.startsWith('//')) return true;
  let url: URL;
  try {
    url = new URL(value.startsWith('//') ? `https:${value}` : value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const cdn = (PAGE_CDN_HOSTS as readonly string[]).includes(url.origin);
  if (kind === 'image') return true;
  if (kind === 'script') return cdn;
  if (kind === 'style') return cdn || url.origin === PAGE_FONT_STYLE_HOST;
  return cdn || url.origin === PAGE_FONT_FILE_HOST;
}
