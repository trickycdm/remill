/**
 * Publish-time analysis of an inline page (D63) — read the author's html once
 * and report (a) the title it declares, and (b) what will not work once it
 * renders inside remill's page, so whoever publishes it (usually an agent)
 * finds out now rather than from a blank chart. Advisory only: nothing here
 * blocks a save, and the response header remains the enforcement.
 *
 * Shares its allowlists with the header through `pageAllows`. Pure and
 * DOM-free (htmlparser2).
 */

import { Parser } from 'htmlparser2';
import { PAGE_CDN_HOSTS, PAGE_FONT_STYLE_HOST, pageAllows } from './policy';

export interface PageHtmlReport {
  /** The document's `<title>`, else its first `<h1>`, whitespace-folded. */
  readonly title: string | null;
  /** Human-readable notes on what will not work on the page. */
  readonly warnings: readonly string[];
}

const MAX_WARNINGS = 20;
const MAX_TITLE_CHARS = 200;
const LARGE_DATA_URI_CHARS = 100_000;

const CDNS = PAGE_CDN_HOSTS.map((h) => h.replace('https://', '')).join(', ');
const FONTS = PAGE_FONT_STYLE_HOST.replace('https://', '');
const fold = (s: string) => s.replace(/\s+/g, ' ').trim();
const short = (url: string) => (url.length > 120 ? `${url.slice(0, 117)}…` : url);

export function analyzePageHtml(html: string): PageHtmlReport {
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (warnings.length < MAX_WARNINGS && !warnings.includes(message)) warnings.push(message);
  };

  let title = '';
  let h1 = '';
  let inTitle = false;
  let inH1 = false;
  let sawH1 = false;
  let svgDepth = 0;
  // Inline script/style bodies, scanned once the tag closes.
  let capture: 'script' | 'style' | null = null;
  let captured = '';

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        for (const value of Object.values(attrs)) {
          if (value.length > LARGE_DATA_URI_CHARS && /^data:/i.test(value)) {
            warn(
              'A large data: URI is embedded in the page. Big images count towards the page size limit — upload them with upload_media and reference the /media/<id> URL instead.',
            );
          }
        }
        if (name === 'svg') svgDepth++;
        if (name === 'title' && !title && svgDepth === 0) inTitle = true;
        else if (name === 'h1' && !sawH1) inH1 = sawH1 = true;
        else if (name === 'script') {
          if (attrs.src === undefined) capture = 'script';
          else if (!pageAllows('script', attrs.src)) {
            warn(`Script ${short(attrs.src)} will not load. Scripts may come from ${CDNS}, this site, or be inline.`);
          }
        } else if (name === 'style') capture = 'style';
        else if (name === 'link' && /\bstylesheet\b/i.test(attrs.rel ?? '') && attrs.href !== undefined) {
          if (!pageAllows('style', attrs.href)) {
            warn(
              `Stylesheet ${short(attrs.href)} will not load. Stylesheets may come from ${CDNS} or ${FONTS}, or be inline.`,
            );
          } else if (!attrs.href.includes(FONTS)) {
            warn(
              `Stylesheet ${short(attrs.href)} applies to the whole remill page, not just yours. Inline <style> is scoped to the page; prefer it.`,
            );
          }
        } else if ((name === 'img' || name === 'source') && attrs.src !== undefined) {
          if (!pageAllows('image', attrs.src))
            warn(`Image ${short(attrs.src)} will not load. Images must be https, data: or served by this site.`);
        } else if (name === 'iframe' || name === 'frame' || name === 'embed' || name === 'object') {
          warn(`<${name}> will not load: the page cannot embed documents from other sites.`);
        } else if (name === 'base') {
          warn('<base> is dropped, so relative URLs resolve against this site.');
        }
      },
      ontext(text) {
        if (inTitle) title += text;
        else if (inH1) h1 += text;
        if (capture) captured += text;
      },
      onclosetag(name) {
        if (name === 'svg') svgDepth = Math.max(0, svgDepth - 1);
        if (name === 'title') inTitle = false;
        else if (name === 'h1') inH1 = false;
        if (name === capture) {
          if (capture === 'script') scanScript(captured, warn);
          else scanStyle(captured, warn);
          capture = null;
          captured = '';
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const declared = fold(title) || fold(h1);
  return { title: declared ? declared.slice(0, MAX_TITLE_CHARS) : null, warnings };
}

function scanScript(code: string, warn: (message: string) => void): void {
  if (/\bfetch\s*\(\s*["'`]https?:|\bnew\s+(WebSocket|EventSource)\s*\(/.test(code)) {
    warn('Network calls to other sites are blocked. Embed the data in the page instead.');
  }
}

function scanStyle(css: string, warn: (message: string) => void): void {
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    if (!pageAllows('style', m[1])) warn(`Stylesheet ${short(m[1])} (@import) will not load.`);
  }
}
