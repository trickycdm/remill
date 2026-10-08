/**
 * Scope an inline page's stylesheet to its wrapper (D63). An inline page's
 * `<style>` was written for a whole document — `* {}`, `body {}`, `:root {}` —
 * and dropped into remill's page unchanged it would restyle the shell around
 * it. `scopeCss` wraps the sheet in `@scope (.rm-page)` and points the
 * document-level selectors (`html`, `body`, `:root`) at the wrapper, which
 * stands in for the page's body.
 *
 * A small brace-depth tokenizer (strings and comments aware), not a CSS parser:
 * it only needs to find top-level statements and selector lists. At-rules that
 * cannot live inside `@scope` (`@import`, `@font-face`, `@keyframes`, …) are
 * hoisted above it unchanged; conditional group rules (`@media`, `@supports`,
 * `@container`, `@layer {}`) are recursed into.
 *
 * Pure — runs on Workers and in the Node test runner alike.
 */

/** The wrapper every inline page renders inside — the `@scope` root. */
export const PAGE_SCOPE = '.rm-page';

/** Statement at-rules and block at-rules that are invalid inside `@scope`. */
const HOISTED = new Set([
  'import',
  'charset',
  'namespace',
  'font-face',
  'keyframes',
  '-webkit-keyframes',
  'property',
  'counter-style',
  'font-feature-values',
  'font-palette-values',
  'page',
]);

/** Group rules whose body is more rules — recursed into. */
const GROUPS = new Set(['media', 'supports', 'container', 'layer', 'document', '-moz-document']);

type Item =
  | { readonly kind: 'statement'; readonly text: string }
  | { readonly kind: 'block'; readonly prelude: string; readonly body: string };

/** Index just past a string or comment starting at `i`, or `i` if neither. */
function skipOpaque(css: string, i: number): number {
  const ch = css[i];
  if (ch === '/' && css[i + 1] === '*') {
    const end = css.indexOf('*/', i + 2);
    return end < 0 ? css.length : end + 2;
  }
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    while (j < css.length && css[j] !== ch) {
      if (css[j] === '\\') j++;
      j++;
    }
    return j + 1;
  }
  return i;
}

/** Split a stylesheet (or a group rule's body) into top-level items. */
function tokenize(css: string): Item[] {
  const items: Item[] = [];
  let start = 0;
  let i = 0;
  while (i < css.length) {
    const skipped = skipOpaque(css, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = css[i];
    if (ch === ';') {
      const text = css.slice(start, i + 1).trim();
      if (text !== ';') items.push({ kind: 'statement', text });
      start = ++i;
    } else if (ch === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        const s = skipOpaque(css, j);
        if (s !== j) {
          j = s;
          continue;
        }
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      items.push({ kind: 'block', prelude: css.slice(start, i).trim(), body: css.slice(i + 1, j - 1) });
      start = i = j;
    } else {
      i++;
    }
  }
  const rest = css.slice(start).trim();
  if (rest) items.push({ kind: 'statement', text: rest });
  return items;
}

const atName = (prelude: string) => /^@([-\w]+)/.exec(prelude.replace(/^(\/\*[\s\S]*?\*\/\s*)+/, ''))?.[1]?.toLowerCase();

/** Split a selector list on top-level commas (not inside parens, brackets or strings). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const skipped = skipOpaque(list, i);
    if (skipped !== i) {
      i = skipped - 1;
      continue;
    }
    const ch = list[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

/**
 * Point one selector's document-level parts at the scope root: `html`, `body`
 * and `:root` become `:scope`, and the chains they form (`html body`,
 * `:root > body`) collapse to one `:scope` — the wrapper is all three.
 */
export function rewriteSelector(selector: string): string {
  const rewritten = selector
    .replace(/:root\b/gi, ':scope')
    .replace(/(^|[\s>+~(,])(?:html|body)(?=$|[\s>+~.#:[),])/gi, '$1:scope');
  return rewritten.replace(/:scope(?:\s*>?\s*:scope)+/g, ':scope');
}

/** Rewrite the rules of a (group) body; hoistable at-rules are collected. */
function rewriteRules(css: string, hoisted: string[]): string {
  const out: string[] = [];
  for (const item of tokenize(css)) {
    if (item.kind === 'statement') {
      const name = atName(item.text);
      // `@import`/`@charset`/`@namespace` and `@layer a, b;` must sit outside.
      if (name && (HOISTED.has(name) || name === 'layer')) hoisted.push(item.text);
      else out.push(item.text);
      continue;
    }
    const name = atName(item.prelude);
    if (name && HOISTED.has(name)) {
      hoisted.push(`${item.prelude}{${item.body}}`);
    } else if (name && GROUPS.has(name)) {
      out.push(`${item.prelude}{${rewriteRules(item.body, hoisted)}}`);
    } else if (name) {
      out.push(`${item.prelude}{${item.body}}`);
    } else {
      out.push(`${splitSelectors(item.prelude).map(rewriteSelector).join(',')}{${item.body}}`);
    }
  }
  return out.join('\n');
}

/** Scope a whole stylesheet to the page wrapper. */
export function scopeCss(css: string): string {
  const hoisted: string[] = [];
  const scoped = rewriteRules(css, hoisted);
  const head = hoisted.length ? `${hoisted.join('\n')}\n` : '';
  return scoped.trim() ? `${head}@scope (${PAGE_SCOPE}) {\n${scoped}\n}` : head;
}

/** `:scope sel` for each selector in a list, so a rule matches only inside the
 *  page — zero specificity, except a pseudo-element's own (it cannot sit
 *  inside `:where`), which any author rule for it matches or beats. */
const inPage = (selectors: string) =>
  selectors
    .split(',')
    .map((sel) => {
      const [base, pseudo] = sel.trim().split('::');
      return `:where(:scope ${base})${pseudo ? `::${pseudo}` : ''}`;
    })
    .join(',');

/**
 * The base sheet every inline page gets before its own styles. Two jobs:
 *
 *  1. The wrapper behaves like a document body: inherited values reset to
 *     their initial ones (nothing leaks in from remill's body), the browser's
 *     8px body margin, and a light canvas — the frame's white page.
 *  2. Inside it, Tailwind's preflight (global, `@layer base`) is undone
 *     property by property — `revert` on exactly what preflight sets, on the
 *     selectors it sets them on — so the page gets the browser defaults it was
 *     written against (heading sizes, list bullets, paragraph margins, inline
 *     images). Deliberately NOT `all: revert`: that also discards SVG
 *     presentation attributes (`fill`, `stroke`) and HTML attribute hints
 *     (`<img width>`), which preflight never touched.
 *
 * Unlayered, so it beats `@layer base`; zero-specificity (`:where`), so any
 * author rule wins. The review overlay's figure outline (D55) is restated
 * because the border/outline reset would otherwise hide it.
 */
export const PAGE_BASE_CSS = [
  `@scope (${PAGE_SCOPE}) {`,
  ':where(:scope){all:initial;display:flow-root;margin:8px;color-scheme:light;color:CanvasText;background:Canvas}',
  `${inPage('*, *::before, *::after, *::backdrop, *::file-selector-button')}{box-sizing:revert;margin:revert;padding:revert;border:revert}`,
  `${inPage('hr')}{height:revert;color:revert;border-top-width:revert}`,
  `${inPage('h1, h2, h3, h4, h5, h6')}{font-size:revert;font-weight:revert}`,
  `${inPage('a')}{color:revert;text-decoration:revert}`,
  `${inPage('code, kbd, samp, pre')}{font-family:revert;font-feature-settings:revert;font-variation-settings:revert;font-size:revert}`,
  `${inPage('abbr[title]')}{text-decoration:revert}`,
  `${inPage('b, strong')}{font-weight:revert}`,
  `${inPage('small')}{font-size:revert}`,
  `${inPage('sub, sup')}{font-size:revert;line-height:revert;position:revert;vertical-align:revert;top:revert;bottom:revert}`,
  `${inPage('table')}{text-indent:revert;border-color:revert;border-collapse:revert}`,
  `${inPage('progress')}{vertical-align:revert}`,
  `${inPage('summary')}{display:revert}`,
  `${inPage('textarea')}{resize:revert}`,
  `${inPage('*::placeholder')}{opacity:revert;color:revert}`,
  `${inPage('ol, ul, menu')}{list-style:revert}`,
  `${inPage('img, svg, video, canvas, audio, iframe, embed, object')}{display:revert;vertical-align:revert}`,
  `${inPage('img, video')}{max-width:revert;height:revert}`,
  `${inPage('button, input, select, optgroup, textarea, *::file-selector-button')}{font:revert;font-feature-settings:revert;font-variation-settings:revert;letter-spacing:revert;color:revert;border-radius:revert;background-color:revert;opacity:revert}`,
  `${inPage('[data-rm-commented]')}{outline:2px dashed var(--color-warning);outline-offset:4px}`,
  `${inPage('[data-rm-commented=active]')}{outline-color:var(--color-pop)}`,
  '}',
].join('');
