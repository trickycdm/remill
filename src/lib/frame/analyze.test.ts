import { describe, it, expect } from 'vitest';
import { analyzeFramedHtml } from './analyze';
import { frameAllows, frameCsp } from './policy';

const doc = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const warningsOf = (html: string) => analyzeFramedHtml(html).warnings;

describe('analyzeFramedHtml (D60) — the title, and what the frame will refuse', () => {
  it('reads the <title>, falls back to the first <h1>, else null', () => {
    expect(
      analyzeFramedHtml(doc('<title>\n  Q3   board pack </title>', '<h1>Other</h1>')).title,
    ).toBe('Q3 board pack');
    expect(
      analyzeFramedHtml(doc('', '<h1>Quarterly <em>metrics</em></h1><h1>Second</h1>')).title,
    ).toBe('Quarterly metrics');
    expect(analyzeFramedHtml(doc('<title>  </title>', '<p>No heading</p>')).title).toBeNull();
    expect(analyzeFramedHtml(doc('<title>A &amp; B</title>', '')).title).toBe('A & B');
    expect(analyzeFramedHtml(doc(`<title>${'x'.repeat(500)}</title>`, '')).title).toHaveLength(200);
  });

  it('is silent for a page that only uses what the frame allows', () => {
    const html = doc(
      '<title>T</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/x/x.css"><link rel="icon" href="http://x/favicon.ico">' +
        '<style>@import url("https://cdnjs.cloudflare.com/ajax/libs/x/x.css"); body { margin: 0 }</style>',
      '<img src="https://example.com/a.png"><img src="/media/med_1"><img src="data:image/png;base64,AAAA">' +
        '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script src="/vendor/chart.umd.js"></script>' +
        '<script src="//unpkg.com/d3"></script><script>const refetch = 1; draw(refetch);</script>' +
        '<form><input name="q"></form><a href="https://example.com">out</a>',
    );
    expect(warningsOf(html)).toEqual([]);
  });

  it('warns about resources the frame will not load', () => {
    const w = warningsOf(
      doc(
        '<link rel="stylesheet" href="https://example.com/site.css"><base href="/x/">' +
          '<style>@import "https://evil.test/a.css";</style>',
        '<script src="https://example.com/app.js"></script><script src="/assets/app.js"></script>' +
          '<img src="http://example.com/a.png"><iframe src="https://example.com"></iframe>' +
          '<form action="/submit"></form>',
      ),
    );
    expect(w).toEqual([
      expect.stringContaining('Stylesheet https://example.com/site.css will not load'),
      expect.stringContaining('<base> is ignored'),
      expect.stringContaining('Stylesheet https://evil.test/a.css (@import) will not load'),
      expect.stringContaining('Script https://example.com/app.js will not load'),
      expect.stringContaining('Script /assets/app.js will not load'),
      expect.stringContaining('Image http://example.com/a.png will not load'),
      expect.stringContaining('<iframe> will not load'),
      expect.stringContaining('Form submission is blocked'),
    ]);
  });

  it('warns about sandboxed APIs used in inline script, once each', () => {
    const w = warningsOf(
      doc(
        '',
        '<script>fetch("/api/x").then(r => r.json());</script><script>fetch("/y"); localStorage.setItem("a", "1"); new WebSocket("wss://x");</script>',
      ),
    );
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('Network calls');
    expect(w[1]).toContain('localStorage');
    // An external script's body is not there to scan — and its src is judged instead.
    expect(warningsOf(doc('', '<script src="https://unpkg.com/x">fetch()</script>'))).toEqual([]);
  });

  it('flags a large embedded data: URI, caps the list, and survives junk', () => {
    expect(
      warningsOf(doc('', `<img src="data:image/png;base64,${'A'.repeat(100_001)}">`))[0],
    ).toContain('upload_media');
    const many = Array.from(
      { length: 40 },
      (_, i) => `<script src="https://h${i}.test/a.js"></script>`,
    ).join('');
    expect(warningsOf(doc('', many))).toHaveLength(20);
    expect(analyzeFramedHtml('<<<not html')).toEqual({ title: null, warnings: [] });
    expect(analyzeFramedHtml('')).toEqual({ title: null, warnings: [] });
  });
});

describe('frameAllows (D60) — the CSP allowlists, read as a predicate', () => {
  it('agrees with the directives frameCsp emits', () => {
    const csp = frameCsp('https://remill.test');
    for (const host of [
      'https://cdnjs.cloudflare.com',
      'https://cdn.jsdelivr.net',
      'https://unpkg.com',
    ]) {
      expect(csp).toContain(host);
      expect(frameAllows('script', `${host}/x.js`)).toBe(true);
      expect(frameAllows('style', `${host}/x.css`)).toBe(true);
      expect(frameAllows('font', `${host}/x.woff2`)).toBe(true);
    }
    expect(frameAllows('style', 'https://fonts.googleapis.com/css2')).toBe(true);
    expect(frameAllows('script', 'https://fonts.googleapis.com/x.js')).toBe(false);
    expect(frameAllows('font', 'https://fonts.gstatic.com/s/x.woff2')).toBe(true);
    expect(frameAllows('image', 'https://anywhere.example/x.png')).toBe(true);
  });

  it('is exact about hosts, schemes and own-site paths', () => {
    expect(frameAllows('script', 'https://cdn.jsdelivr.net.evil.test/x.js')).toBe(false);
    expect(frameAllows('script', 'https://evil.test/cdn.jsdelivr.net/x.js')).toBe(false);
    expect(frameAllows('script', 'http://cdn.jsdelivr.net/x.js')).toBe(false);
    expect(frameAllows('script', '//cdn.jsdelivr.net/x.js')).toBe(true);
    expect(frameAllows('script', '/vendor/chart.umd.js')).toBe(true);
    expect(frameAllows('script', 'vendor/chart.umd.js')).toBe(true);
    expect(frameAllows('script', '/src/client/x.js')).toBe(false);
    expect(frameAllows('font', '/fonts/a.woff2')).toBe(true);
    expect(frameAllows('font', '/vendor/a.woff2')).toBe(false);
    expect(frameAllows('image', '/media/med_1')).toBe(true);
    expect(frameAllows('image', 'http://x.test/a.png')).toBe(false);
    expect(frameAllows('image', 'data:image/png;base64,AA')).toBe(true);
    expect(frameAllows('script', 'data:text/javascript,alert(1)')).toBe(false);
    expect(frameAllows('script', 'javascript:alert(1)')).toBe(false);
    expect(frameAllows('script', 'https://')).toBe(false);
  });
});
