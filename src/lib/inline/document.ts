/**
 * Inline-page preparation (D63). In `renderMode: 'inline'` the collection's
 * FIRST `html` field is a whole document the author owns, rendered INSIDE
 * remill's own page — no iframe — so the review overlay works on it directly
 * and its scripts run on remill's origin (trusted single author, D25/D63).
 *
 * `prepareInlineDocument` turns that document into the contents of one
 * wrapper element: the document-level tags (`<!doctype>`, `<html>`, `<head>`,
 * `<body>`) are dropped and their presentational attributes move to the
 * wrapper, `<title>`/`<meta>`/`<base>` are dropped (the shell owns the head),
 * every `<style>` is scoped to the wrapper (`scopeCss`), and everything else —
 * scripts, links, markup — is kept verbatim and in order, so head scripts
 * still run before the body exists.
 *
 * Pure and DOM-free (htmlparser2 — runs on Workers and in the Node test
 * runner alike).
 */

import { Parser } from 'htmlparser2';
import type { CollectionDefinition } from '@/fields/types';
import { pageFieldOf } from '@/lib/page-field';
import { scopeCss } from './css';

/** The inline page's html, or null when the collection isn't inline-mode or
 *  the value is empty — callers fall back to the shell render so a page is
 *  never blank (the same contract as `rawPageHtml`/`framePageHtml`). */
export function inlinePageHtml(
  def: CollectionDefinition,
  data: Record<string, unknown>,
): string | null {
  if (def.renderMode !== 'inline') return null;
  const key = pageFieldOf(def);
  const page = key ? data[key] : undefined;
  return typeof page === 'string' && page.trim() ? page : null;
}

/** Attributes the document's `<html>`/`<body>` carried that still mean
 *  something on the wrapper that stands in for them. */
export interface InlineWrapperAttrs {
  readonly class?: string;
  readonly style?: string;
  readonly lang?: string;
  readonly dir?: string;
}

export interface InlineDocument {
  /** The document's `<title>`, whitespace-folded, or null. */
  readonly title: string | null;
  readonly attrs: InlineWrapperAttrs;
  /** The wrapper's inner html. */
  readonly html: string;
}

const DOCUMENT_TAGS = new Set(['html', 'head', 'body']);
const DROPPED_VOID = new Set(['meta', 'base']);

interface Edit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export function prepareInlineDocument(source: string): InlineDocument {
  const edits: Edit[] = [];
  const classes: string[] = [];
  const attrs: { style?: string; lang?: string; dir?: string } = {};
  let title = '';
  let sawTitle = false;
  let titleStart = -1;
  let styleStart = -1;
  let svgDepth = 0;

  const drop = (from: number, to: number) => edits.push({ from, to, text: '' });

  const parser = new Parser(
    {
      onprocessinginstruction(name) {
        if (name.toLowerCase() === '!doctype') drop(parser.startIndex, parser.endIndex + 1);
      },
      onopentag(name, attribs) {
        if (name === 'svg') svgDepth++;
        if (DOCUMENT_TAGS.has(name)) {
          drop(parser.startIndex, parser.endIndex + 1);
          if (attribs.class) classes.push(attribs.class);
          // Body wins over html for the rest — it is the closer stand-in.
          if (attribs.style) attrs.style = attrs.style ? `${attrs.style};${attribs.style}` : attribs.style;
          if (attribs.lang) attrs.lang = attribs.lang;
          if (attribs.dir) attrs.dir = attribs.dir;
        } else if (DROPPED_VOID.has(name) && svgDepth === 0) {
          drop(parser.startIndex, parser.endIndex + 1);
        } else if (name === 'title' && svgDepth === 0) {
          titleStart = parser.startIndex;
        } else if (name === 'style') {
          styleStart = parser.endIndex + 1;
        }
      },
      ontext(text) {
        if (titleStart >= 0 && !sawTitle) title += text;
      },
      onclosetag(name, isImplied) {
        if (name === 'svg') svgDepth = Math.max(0, svgDepth - 1);
        if (isImplied) {
          if (name === 'title') titleStart = -1;
          if (name === 'style') styleStart = -1;
          return;
        }
        if (DOCUMENT_TAGS.has(name)) {
          drop(parser.startIndex, parser.endIndex + 1);
        } else if (name === 'title' && titleStart >= 0) {
          drop(titleStart, parser.endIndex + 1);
          titleStart = -1;
          sawTitle = true;
        } else if (name === 'style' && styleStart >= 0) {
          const css = source.slice(styleStart, parser.startIndex);
          edits.push({ from: styleStart, to: parser.startIndex, text: scopeCss(css) });
          styleStart = -1;
        }
      },
    },
    { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
  );
  parser.write(source);
  parser.end();

  let html = '';
  let at = 0;
  for (const edit of edits.sort((a, b) => a.from - b.from)) {
    if (edit.from < at) continue;
    html += source.slice(at, edit.from) + edit.text;
    at = edit.to;
  }
  html += source.slice(at);

  const folded = title.replace(/\s+/g, ' ').trim();
  return {
    title: folded || null,
    attrs: { ...attrs, ...(classes.length ? { class: classes.join(' ') } : {}) },
    html,
  };
}
