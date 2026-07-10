/**
 * Homepage route behavior: `/` always renders the product page. A fresh
 * install (no public collections) must get a 200 with the marketing content
 * and the empty writing index, NOT the old redirect to /admin (that headless
 * posture was removed with the marketing homepage).
 */

import { describe, it, expect } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';

describe('homepage (marketing)', () => {
  const env = {
    DB: createTestD1({ seed: true }),
    SESSION_SECRET: 'x'.repeat(32),
    BASE_URL: 'https://example.org',
  };

  it('renders 200 with the marketing page on an empty install (no redirect)', async () => {
    const res = await app.request('/', {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Content that works for humans, apps, and agents.');
    expect(html).toContain('Nothing published yet');
    expect(html).toContain('id="connect"');
    expect(html).toContain('https://example.org/mcp');
  });

  it('surface previews mirror the real wire shapes, and tabs carry APG keyboard state', async () => {
    const res = await app.request('/', {}, env);
    const html = await res.text();
    // REST snippet: the real flat list envelope + doc_-prefixed ids — never
    // the fake nested page object the section once showed.
    expect(html).toContain('&quot;pageSize&quot;: 20');
    expect(html).not.toContain('&quot;size&quot;');
    expect(html).toContain('doc_aF9x2qWn41Kd');
    expect(html).toContain('doc_b7Kp0dXr93Fh');
    // Tabs: selected-state styling keys off aria-selected (scoped rule must
    // survive Hono's <style> escaping — unquoted CSS ident), and the roving
    // tabindex starts 0 on the selected tab, -1 elsewhere.
    expect(html).toContain('[data-rm-tab][aria-selected=true]');
    expect(html).toContain('id="surface-tab-admin"');
    expect(html).toMatch(/id="surface-tab-admin"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="surface-tab-rest"[^>]*tabindex="-1"/);
  });

  it('emits the discovery head props (canonical, og, feed, favicon)', async () => {
    const res = await app.request('/', {}, env);
    const html = await res.text();
    expect(html).toContain('<link rel="canonical" href="https://example.org/"');
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('type="application/rss+xml"');
    expect(html).toContain('href="/favicon.svg"');
  });
});
