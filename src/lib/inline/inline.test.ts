import { describe, it, expect } from 'vitest';
import { scopeCss, rewriteSelector, PAGE_BASE_CSS } from './css';
import { prepareInlineDocument, inlinePageHtml } from './document';
import { analyzePageHtml } from './analyze';
import { pageAllows } from './policy';
import type { CollectionDefinition } from '@/fields/types';

describe('rewriteSelector — document selectors target the page wrapper (D63)', () => {
  it.each([
    ['body', ':scope'],
    ['html', ':scope'],
    [':root', ':scope'],
    ['html body', ':scope'],
    [':root > body', ':scope'],
    ['body.dark h1', ':scope.dark h1'],
    [':root[data-theme="light"]', ':scope[data-theme="light"]'],
    ['body > main p', ':scope > main p'],
  ])('%s → %s', (input, expected) => {
    expect(rewriteSelector(input)).toBe(expected);
  });

  it.each(['.body', '#html', 'tbody', '[data-x=body]', 'a.htmlish', 'nobody'])('leaves %s alone', (input) => {
    expect(rewriteSelector(input)).toBe(input);
  });
});

describe('scopeCss', () => {
  it('wraps rules in @scope and rewrites document selectors', () => {
    const out = scopeCss('*{box-sizing:border-box} body{margin:0} :root{--bg:#000} h1,html p{color:red}');
    expect(out).toMatch(/^@scope \(\.rm-page\) \{/);
    expect(out).toContain('*{box-sizing:border-box}');
    expect(out).toContain(':scope{margin:0}');
    expect(out).toContain(':scope{--bg:#000}');
    expect(out).toContain('h1,:scope p{color:red}');
  });

  it('hoists at-rules that cannot live inside @scope, in order', () => {
    const css =
      "@import url('https://fonts.googleapis.com/css2?family=X');@font-face{font-family:X;src:url(x.woff2)}" +
      '@keyframes spin{to{transform:rotate(1turn)}}@layer base, theme;p{color:red}';
    const out = scopeCss(css);
    const scopeAt = out.indexOf('@scope');
    for (const hoisted of ['@import', '@font-face', '@keyframes', '@layer base, theme;']) {
      expect(out.indexOf(hoisted)).toBeGreaterThanOrEqual(0);
      expect(out.indexOf(hoisted)).toBeLessThan(scopeAt);
    }
    expect(out.indexOf('@import')).toBe(0);
    expect(out.slice(scopeAt)).toContain('p{color:red}');
  });

  it('recurses into @media/@supports and rewrites inside them', () => {
    const out = scopeCss('@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#fff}}');
    expect(out).toContain('@media (prefers-color-scheme: light){:scope:not([data-theme="dark"]){--bg:#fff}}');
  });

  it('is not fooled by braces in strings and comments', () => {
    const out = scopeCss('/* body { } */ .q::before{content:"}{ body"} body{margin:0}');
    expect(out).toContain('.q::before{content:"}{ body"}');
    expect(out).toContain(':scope{margin:0}');
  });

  it('emits nothing to scope for a sheet of only hoisted rules', () => {
    expect(scopeCss('@font-face{font-family:X}')).not.toContain('@scope');
  });
});

describe('PAGE_BASE_CSS — undo preflight, nothing more', () => {
  it('never reverts every property on page content (it would erase SVG fill/stroke attributes)', () => {
    expect(PAGE_BASE_CSS).not.toMatch(/\*\)\{all:/);
    expect(PAGE_BASE_CSS).not.toMatch(/fill|stroke/);
  });

  it('restores the defaults preflight takes away', () => {
    for (const rule of [
      ':where(:scope h1),',
      'font-size:revert;font-weight:revert',
      ':where(:scope ol),',
      'list-style:revert',
      ':where(:scope sup)',
      'vertical-align:revert',
    ]) {
      expect(PAGE_BASE_CSS).toContain(rule);
    }
  });

  it('keeps pseudo-elements out of :where (they are invalid inside it)', () => {
    expect(PAGE_BASE_CSS).not.toMatch(/:where\([^)]*::/);
    expect(PAGE_BASE_CSS).toContain(':where(:scope *)::before');
  });
});

describe('prepareInlineDocument', () => {
  const doc = `<!DOCTYPE html>
<html lang="en-GB" class="theme">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>  The   Report </title>
<base href="https://example.com/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<style>body{margin:0;background:var(--bg)} :root{--bg:#111}</style>
<script>window.early = 1;</script>
</head>
<body class="dark" style="color:red">
<h1>Report</h1>
<svg viewBox="0 0 1 1"><title>chart</title><rect/></svg>
<script>document.querySelectorAll('h1').length;</script>
</body>
</html>`;

  it('takes the title and moves html/body attributes to the wrapper', () => {
    const page = prepareInlineDocument(doc);
    expect(page.title).toBe('The Report');
    expect(page.attrs).toEqual({ lang: 'en-GB', class: 'theme dark', style: 'color:red' });
  });

  it('drops document tags, title, meta and base; keeps links, scripts and svg titles in order', () => {
    const { html } = prepareInlineDocument(doc);
    expect(html).not.toMatch(/<!doctype|<\/?html|<\/?head|<\/?body|<meta|<base/i);
    expect(html).not.toContain('The   Report');
    expect(html).toContain('<title>chart</title>');
    const order = ['<link rel="preconnect"', '<style>', 'window.early', '<h1>Report</h1>', 'querySelectorAll'];
    const positions = order.map((s) => html.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('scopes every <style>', () => {
    const { html } = prepareInlineDocument(doc);
    expect(html).toContain('@scope (.rm-page)');
    expect(html).toContain(':scope{margin:0;background:var(--bg)}');
    expect(html).toContain(':scope{--bg:#111}');
  });

  it('passes a bare fragment through, still scoping its styles', () => {
    const page = prepareInlineDocument('<style>body{margin:0}</style><p>Hi</p>');
    expect(page.title).toBeNull();
    expect(page.attrs).toEqual({});
    expect(page.html).toContain('<p>Hi</p>');
    expect(page.html).toContain(':scope{margin:0}');
  });
});

describe('inlinePageHtml', () => {
  const def = (renderMode: CollectionDefinition['renderMode']) =>
    ({
      slug: 'pages',
      name: 'Pages',
      shape: 'collection',
      fields: [{ key: 'title', type: 'text' }, { key: 'html', type: 'html' }],
      renderMode,
    }) as CollectionDefinition;

  it('returns the page field in inline mode only', () => {
    expect(inlinePageHtml(def('inline'), { html: '<p>x</p>' })).toBe('<p>x</p>');
    expect(inlinePageHtml(def('frame'), { html: '<p>x</p>' })).toBeNull();
    expect(inlinePageHtml(def('inline'), { html: '   ' })).toBeNull();
  });
});

describe('the page policy, read both ways', () => {
  it.each([
    ['script', 'https://cdn.jsdelivr.net/npm/chart.js', true],
    ['script', '/vendor/chart.umd.js', true],
    ['script', 'https://evil.example/x.js', false],
    ['style', 'https://fonts.googleapis.com/css2?family=X', true],
    ['font', 'https://fonts.gstatic.com/s/x.woff2', true],
    ['image', 'https://images.example/x.png', true],
    ['image', 'http://images.example/x.png', false],
  ] as const)('%s %s → %s', (kind, url, allowed) => {
    expect(pageAllows(kind, url)).toBe(allowed);
  });

  it('warns about what will not work, and about unscoped stylesheets', () => {
    const { title, warnings } = analyzePageHtml(
      '<title>T</title><script src="https://evil.example/x.js"></script>' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x.css">' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">' +
        '<script>fetch("https://api.example/data")</script>',
    );
    expect(title).toBe('T');
    expect(warnings.some((w) => w.includes('evil.example') && w.includes('will not load'))).toBe(true);
    expect(warnings.some((w) => w.includes('x.css') && w.includes('whole remill page'))).toBe(true);
    expect(warnings.some((w) => w.includes('fonts.googleapis.com/css2'))).toBe(false);
    expect(warnings.some((w) => w.includes('Network calls'))).toBe(true);
  });
});
