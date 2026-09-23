import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import * as documentsService from '@/services/documents';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-04T12:00:00Z';

const ARTICLES: CollectionDefinition = {
  slug: 'articles',
  name: 'Articles',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true },
    { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
    { key: 'excerpt', type: 'text' },
    { key: 'body', type: 'markdown' },
  ],
  workflow: { draftPublish: true },
  access: { publicRead: true },
  template: 'article',
};

describe('GET /:collection/:slug — rich SEO head (D52)', () => {
  let db: Database;
  let env: { DB: D1Database; MEDIA: R2Bucket; SESSION_SECRET: string; BASE_URL: string };
  let admin: Principal;

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    env = { DB: d1, MEDIA: {} as R2Bucket, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'https://example.org' };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, ARTICLES, NOW);
  });

  it('emits og:site_name, a lead-derived og:description, twitter:title, and application/ld+json', async () => {
    const created = await documentsService.createDocument(
      db,
      admin,
      'articles',
      { title: 'A Public Post', excerpt: 'The standfirst dek.', body: 'Body prose.' },
      NOW,
      { status: 'published' },
    );

    const res = await app.request(`/articles/${created.id}`, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('property="og:site_name" content="remill"');
    expect(html).toContain('property="og:description" content="The standfirst dek."');
    expect(html).toContain('name="twitter:title" content="A Public Post"');
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"@type":"BlogPosting"');
    expect(res.headers.get('X-Robots-Tag')).toBeNull();
  });

  it('with no text and no siteDescription, still emits og:title/og:url/twitter:title (description undefined ≠ bare)', async () => {
    const created = await documentsService.createDocument(
      db,
      admin,
      'articles',
      { title: 'No Body Post' },
      NOW,
      { status: 'published' },
    );

    const res = await app.request(`/articles/${created.id}`, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('property="og:title" content="No Body Post"');
    expect(html).toMatch(/property="og:url" content="/);
    expect(html).toContain('name="twitter:title" content="No Body Post"');
  });

  it('an unlisted published document sets X-Robots-Tag: noindex and omits canonical', async () => {
    const created = await documentsService.createDocument(
      db,
      admin,
      'articles',
      { title: 'An Unlisted Post', excerpt: 'Dek.', body: 'Body.' },
      NOW,
      { status: 'published' },
    );
    await documentsService.setVisibility(db, admin, 'articles', created.id, 'unlisted', NOW);

    const res = await app.request(`/articles/${created.id}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toContain('rel="canonical"');

    // The slug URL 404s for an unlisted document (Part 1's access change).
    const bySlug = await app.request('/articles/an-unlisted-post', {}, env);
    expect(bySlug.status).toBe(404);
  });

  it('an unlisted RAW-MODE document still sets X-Robots-Tag: noindex (the header is set before the raw early return)', async () => {
    const RAW_PAGES: CollectionDefinition = {
      slug: 'pages',
      name: 'Pages',
      shape: 'collection',
      fields: [
        { key: 'title', type: 'text', required: true, index: true },
        { key: 'slug', type: 'slug', config: { from: 'title' }, unique: true, index: true },
        { key: 'page', type: 'html' },
      ],
      workflow: { draftPublish: true },
      access: { publicRead: true },
      renderMode: 'raw',
    };
    await collectionsService.createCollection(db, admin, RAW_PAGES, NOW);
    const created = await documentsService.createDocument(
      db,
      admin,
      'pages',
      { title: 'A Raw Page', page: '<!doctype html><title>Raw</title><p>Hi</p>' },
      NOW,
      { status: 'published' },
    );
    await documentsService.setVisibility(db, admin, 'pages', created.id, 'unlisted', NOW);

    const res = await app.request(`/pages/${created.id}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('<p>Hi</p>');
  });

  it('a private document 404s and never reaches the head builder', async () => {
    const created = await documentsService.createDocument(
      db,
      admin,
      'articles',
      { title: 'A Private Post', excerpt: 'Dek.', body: 'Body.' },
      NOW,
      { status: 'published' },
    );
    await documentsService.setVisibility(db, admin, 'articles', created.id, 'private', NOW);

    const res = await app.request(`/articles/${created.id}`, {}, env);
    expect(res.status).toBe(404);
  });
});
