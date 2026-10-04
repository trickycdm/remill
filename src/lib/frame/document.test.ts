import { describe, it, expect } from 'vitest';
import type { CollectionDefinition } from '@/fields/types';
import { framePageHtml, prepareFramedDocument, FRAME_PREAMBLE } from './document';

const P = '<!--P-->';

const def = (renderMode: CollectionDefinition['renderMode']): CollectionDefinition => ({
  slug: 'pages',
  name: 'Pages',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'html', type: 'html' },
    { key: 'second', type: 'html' },
  ],
  renderMode,
});

describe('framePageHtml (D60)', () => {
  it('is the FIRST html field of a frame-mode collection', () => {
    expect(framePageHtml(def('frame'), { html: '<p>one</p>', second: '<p>two</p>' })).toBe(
      '<p>one</p>',
    );
  });

  it('is null off frame mode and for an empty page — callers fall back to the shell', () => {
    expect(framePageHtml(def('raw'), { html: '<p>x</p>' })).toBeNull();
    expect(framePageHtml(def(undefined), { html: '<p>x</p>' })).toBeNull();
    expect(framePageHtml(def('frame'), { html: '   ' })).toBeNull();
    expect(framePageHtml(def('frame'), {})).toBeNull();
  });
});

describe('prepareFramedDocument (D60)', () => {
  it('injects just inside <head> of a full document, leaving the author markup untouched', () => {
    const html =
      '<!doctype html>\n<html lang="en-GB">\n<head>\n<meta charset="utf-8"><title>T</title></head><body><p>Hi</p></body></html>';
    const out = prepareFramedDocument(html, P);
    expect(out).toBe(html.replace('<head>', `<head>${P}`));
  });

  it('handles attributes and case on <head>/<html>', () => {
    expect(
      prepareFramedDocument(
        '<!DOCTYPE html><HTML><HEAD data-x="1"><title>T</title></HEAD><body></body></HTML>',
        P,
      ),
    ).toContain(`<HEAD data-x="1">${P}<title>`);
  });

  it('falls back to just inside <html>, then to right after the doctype — never before it', () => {
    expect(prepareFramedDocument('<!doctype html><html><body><p>x</p></body></html>', P)).toBe(
      `<!doctype html><html>${P}<body><p>x</p></body></html>`,
    );
    const out = prepareFramedDocument('<!doctype html><p>x</p>', P);
    expect(out).toBe(`<!doctype html>${P}<p>x</p>`);
    expect(out.startsWith('<!doctype html>')).toBe(true);
  });

  it('wraps a bare fragment in a minimal standards-mode document', () => {
    const out = prepareFramedDocument('<h1>Report</h1><script>draw()</script>', P);
    expect(out.startsWith('<!doctype html><html><head>')).toBe(true);
    expect(out).toContain(`${P}</head><body><h1>Report</h1><script>draw()</script></body></html>`);
  });

  it('ignores a <head> that appears after content (e.g. inside a string or svg)', () => {
    const out = prepareFramedDocument('<p>text</p><head></head>', P);
    expect(out).toContain('<body><p>text</p><head></head></body>');
  });

  it('the default preamble is the frame bridge, as one safely inlined classic script', () => {
    expect(prepareFramedDocument('<p>x</p>')).toContain(FRAME_PREAMBLE);
    expect(FRAME_PREAMBLE.startsWith('<script data-rm-frame>')).toBe(true);
    // New-tab links, and the review messages.
    expect(FRAME_PREAMBLE).toContain('_blank');
    expect(FRAME_PREAMBLE).toContain('rm-frame');
    // Exactly one closing tag: nothing inside the bundle can end the script early.
    expect(FRAME_PREAMBLE.match(/<\/script/gi)).toHaveLength(1);
    // A classic script: no module syntax survives bundling.
    expect(FRAME_PREAMBLE).not.toMatch(/\bimport\s|\bexport\s/);
  });
});
