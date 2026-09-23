import { describe, it, expect } from 'vitest';
import { canonicalFromHtml, canonicalDocument } from './canonical';
import { foldWhitespace } from './text';
import { locateQuote, resolveAnchor, relocateAnchor, type TextAnchor } from './anchor';
import { InputValidationError } from '@/lib/errors';
import type { CollectionDefinition } from '@/fields/types';

describe('canonical text (D55)', () => {
  it('concatenates text in order, folding whitespace, with no block separators', () => {
    const c = canonicalFromHtml('<h1>Title</h1>\n\n<p>First   para\n line.</p><p>Second</p>');
    expect(c.text).toBe('Title First para line.Second');
  });

  it('skips script, style, noscript and template content', () => {
    const c = canonicalFromHtml(
      '<p>Before</p><script>const x = "not prose";</script><style>p{}</style><noscript>n</noscript><template><p>t</p></template><p>After</p>',
    );
    expect(c.text).toBe('BeforeAfter');
  });

  it('decodes entities', () => {
    expect(canonicalFromHtml('<p>Fish &amp; chips &lt;3 &nbsp;x</p>').text).toBe('Fish & chips <3 x');
  });

  it('records data-rm-anchor blocks and images by src, with offsets into the text', () => {
    const c = canonicalFromHtml(
      '<p>Intro.</p><figure data-rm-anchor="revenue"><canvas></canvas><figcaption>Revenue by month</figcaption></figure><img src="/media/med_1"><p>End.</p>',
    );
    expect(c.text).toBe('Intro.Revenue by monthEnd.');
    const revenue = c.blocks.find((b) => b.id === 'revenue')!;
    expect(c.text.slice(revenue.start, revenue.end)).toBe('Revenue by month');
    expect(c.blocks.map((b) => b.id)).toContain('img:/media/med_1');
  });

  it('canonicalDocument covers html and markdown fields only, skipping empty ones', () => {
    const def: CollectionDefinition = {
      slug: 'docs',
      name: 'Docs',
      shape: 'collection',
      fields: [
        { key: 'title', type: 'text' },
        { key: 'body', type: 'markdown' },
        { key: 'page', type: 'html' },
        { key: 'notes', type: 'markdown' },
      ],
    };
    const fields = canonicalDocument(def, {
      title: 'Not annotatable',
      body: '# Heading\n\nSome **bold** text.',
      page: '<div data-rm-anchor="chart">Chart</div>',
      notes: '   ',
    });
    expect([...fields.keys()]).toEqual(['body', 'page']);
    expect(fields.get('body')!.text).toBe('Heading Some bold text.'); // micromark's newline between blocks
  });

  it('foldWhitespace matches the folding applied to documents', () => {
    expect(foldWhitespace('  a \n\t b  ')).toBe('a b');
  });
});

describe('locateQuote', () => {
  const text = 'the cat sat. the cat ran. the dog sat.';

  it('returns null when the quote is gone', () => {
    expect(locateQuote(text, 'the bird', {})).toBeNull();
  });

  it('disambiguates repeated quotes by context', () => {
    expect(locateQuote(text, 'the cat', { suffix: ' ran' })).toBe(13);
    expect(locateQuote(text, 'the cat', { suffix: ' sat' })).toBe(0);
  });

  it('falls back to the occurrence nearest the old offset when context no longer helps', () => {
    expect(locateQuote(text, 'the cat', { prefix: 'zzz', start: 15 })).toBe(13);
  });
});

describe('resolveAnchor + relocateAnchor', () => {
  const fields = new Map([
    ['body', canonicalFromHtml('<p>Revenue grew 12% in Q3.</p><figure data-rm-anchor="chart"><figcaption>Q3</figcaption></figure>')],
  ]);

  it('locates a text quote, finding the field when the caller omits it (the agent case)', () => {
    const a = resolveAnchor({ kind: 'text', quote: 'grew 12%' }, fields) as TextAnchor;
    expect(a).toMatchObject({ kind: 'text', field: 'body', quote: 'grew 12%', start: 8 });
    expect(a.prefix).toBe('Revenue ');
  });

  it('downgrades a quote the server cannot see to its enclosing block, else to the document', () => {
    expect(resolveAnchor({ kind: 'text', quote: '$4.2m (live)', blockId: 'chart' }, fields)).toEqual({
      kind: 'block',
      field: 'body',
      blockId: 'chart',
    });
    expect(resolveAnchor({ kind: 'text', quote: '$4.2m (live)' }, fields)).toEqual({
      kind: 'document',
      quote: '$4.2m (live)',
    });
  });

  it('rejects malformed proposals as validation errors', () => {
    expect(() => resolveAnchor({ kind: 'text', quote: '  ' }, fields)).toThrow(InputValidationError);
    expect(() => resolveAnchor({ kind: 'block' }, fields)).toThrow(InputValidationError);
    expect(() => resolveAnchor({ kind: 'text', quote: 'x', field: 'title' }, fields)).toThrow(
      InputValidationError,
    );
  });

  it('moves a text anchor when text is inserted before it', () => {
    const anchor = resolveAnchor({ kind: 'text', quote: 'grew 12%' }, fields);
    const edited = new Map([['body', canonicalFromHtml('<p>Headline: Revenue grew 12% in Q3.</p>')]]);
    const r = relocateAnchor(anchor, edited);
    expect(r.status).toBe('anchored');
    expect((r.anchor as TextAnchor).start).toBe(18);
  });

  it('marks a text anchor outdated when its quote is edited away, keeping the old anchor', () => {
    const anchor = resolveAnchor({ kind: 'text', quote: 'grew 12%' }, fields);
    const edited = new Map([['body', canonicalFromHtml('<p>Revenue grew 15% in Q3.</p>')]]);
    expect(relocateAnchor(anchor, edited)).toEqual({ anchor, status: 'outdated' });
  });

  it('keeps a block anchor while the block exists and marks it outdated when removed', () => {
    const anchor = resolveAnchor({ kind: 'block', blockId: 'chart' }, fields);
    expect(relocateAnchor(anchor, fields).status).toBe('anchored');
    expect(relocateAnchor(anchor, new Map([['body', canonicalFromHtml('<p>No chart</p>')]])).status).toBe(
      'outdated',
    );
  });
});
