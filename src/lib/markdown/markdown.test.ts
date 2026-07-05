import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '@/lib/markdown';

describe('markdown renderer — sanitized by construction (C1, D23)', () => {
  it('renders CommonMark + GFM', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** text.\n\n| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<table>');
  });

  it('XSS: raw HTML is escaped, never emitted as markup', () => {
    const html = renderMarkdown('before <script>alert(1)</script> after');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('XSS: event-handler HTML is escaped too', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('XSS: javascript: link destinations are stripped', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a');
  });

  it('safe links and images pass through', () => {
    const html = renderMarkdown('[ok](https://example.com) ![alt](/media/med_abc)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('src="/media/med_abc"');
    expect(html).toContain('alt="alt"');
  });
});
