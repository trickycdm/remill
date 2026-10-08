/**
 * The frame policy (D60) — what an author-supplied document may do once it is
 * rendered inside the viewer shell's sandboxed iframe. ONE module owns the
 * allowlists so the response headers and the publish-time warnings can never
 * disagree about what loads.
 *
 * The isolation boundary is the SANDBOX, not the CSP: without
 * `allow-same-origin` the document runs in an opaque origin — it cannot read
 * remill's cookies, storage, or DOM, and cannot call remill's API as the
 * viewer. The CSP then limits what the page may pull in. `connect-src 'none'`
 * is defence in depth, not a hard exfiltration boundary: any-https images,
 * popups and downloads remain outbound channels, so the D25 trusted-author
 * model still applies to who may write an html field.
 */

import { PAGE_CDN_HOSTS, PAGE_FONT_STYLE_HOST, PAGE_FONT_FILE_HOST } from '@/lib/inline/policy';

/** Library CDNs a framed page may load scripts, styles and fonts from — the
 *  same hosts an inline page (D63) may use. */
export const FRAME_CDN_HOSTS = PAGE_CDN_HOSTS;

export const FRAME_FONT_STYLE_HOST = PAGE_FONT_STYLE_HOST;
export const FRAME_FONT_FILE_HOST = PAGE_FONT_FILE_HOST;

/**
 * Sandbox tokens — the SAME list goes on the iframe attribute and in the
 * response's CSP `sandbox` directive, so opening the content URL directly is
 * sandboxed too. Never `allow-same-origin` (the whole point) and never
 * `allow-top-navigation*` (the page must not navigate the shell).
 *
 *  - allow-scripts: charts, and the comment bridge.
 *  - allow-popups + allow-popups-to-escape-sandbox: outbound links open as
 *    ordinary tabs.
 *  - allow-forms: without it `submit` never fires, breaking JS-only forms; the
 *    CSP's `form-action 'none'` still blocks a real submission.
 *  - allow-downloads: CSV/blob exports. allow-modals: `window.print()`.
 */
export const FRAME_SANDBOX_TOKENS = [
  'allow-scripts',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-forms',
  'allow-downloads',
  'allow-modals',
] as const;

export const FRAME_SANDBOX = FRAME_SANDBOX_TOKENS.join(' ');

/** What kind of resource a framed page is loading — the frame CSP's directives. */
export type FrameResourceKind = 'script' | 'style' | 'font' | 'image';

const hostIn = (url: URL, hosts: readonly string[]) => hosts.includes(url.origin);

/**
 * Whether the frame policy lets a page load `raw` (a URL as written in the
 * page: absolute, protocol-relative, or site-relative) as `kind`. The SAME
 * allowlists `frameCsp` emits, read the other way — so the warnings an author
 * gets at publish time (`analyzeFramedHtml`) cannot disagree with the headers.
 * `data:`/`blob:` are answered per kind; anything unparseable is refused.
 */
export function frameAllows(kind: FrameResourceKind, raw: string): boolean {
  const value = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1].toLowerCase();
  if (scheme === 'data') return kind === 'image' || kind === 'font';
  if (scheme === 'blob') return kind === 'image';
  // Site-relative (served by remill itself): path-scoped, except images.
  if (!scheme && !value.startsWith('//')) {
    const path = value.startsWith('/') ? value : `/${value}`;
    if (kind === 'image') return true;
    if (kind === 'font') return path.startsWith('/fonts/');
    return path.startsWith('/vendor/');
  }
  let url: URL;
  try {
    url = new URL(value.startsWith('//') ? `https:${value}` : value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (kind === 'image') return true;
  if (kind === 'script') return hostIn(url, FRAME_CDN_HOSTS);
  if (kind === 'style') return hostIn(url, FRAME_CDN_HOSTS) || url.origin === FRAME_FONT_STYLE_HOST;
  return hostIn(url, FRAME_CDN_HOSTS) || url.origin === FRAME_FONT_FILE_HOST;
}

/**
 * The Content-Security-Policy for a framed document. `origin` is the REQUEST
 * origin (never the admin-editable site URL): `'self'` does not match under an
 * opaque origin, so remill's own vendored assets are listed explicitly — and
 * path-scoped, so the frame cannot load arbitrary same-host scripts.
 */
export function frameCsp(origin: string): string {
  const cdn = FRAME_CDN_HOSTS.join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${origin}/vendor/ ${cdn}`,
    `style-src 'unsafe-inline' ${origin}/vendor/ ${cdn} ${FRAME_FONT_STYLE_HOST}`,
    `font-src ${origin}/fonts/ ${FRAME_FONT_FILE_HOST} ${cdn} data:`,
    `img-src https: data: blob: ${origin}`,
    `media-src ${origin} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    `sandbox ${FRAME_SANDBOX}`,
  ].join('; ');
}

/** Every header the frame content route answers with. No `X-Frame-Options`
 *  (the document exists to be framed by its own shell); never cacheable or
 *  indexable; and no referrer, because the ticket rides in the URL. */
export function frameResponseHeaders(origin: string): Record<string, string> {
  return {
    'Content-Security-Policy': frameCsp(origin),
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}
