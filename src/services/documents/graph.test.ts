/**
 * graphData (the /admin/graph explorer, D45) — nodes + edges scoped by the
 * caller's read access. The access-critical properties: node visibility is
 * compiled IN-QUERY from the caller's read filter, and the access-blind edge
 * scan is intersected against the visible node set — an invisible endpoint
 * silently removes the edge (the backlinks never-a-leak posture). Only
 * `index: true` relation fields produce edges.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import * as collectionsService from '@/services/collections';
import * as docs from '@/services/documents';
import { seedRoles, makePrincipal } from '@/test/access';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-17T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
};

const NOTES: CollectionDefinition = {
  slug: 'notes',
  name: 'Notes',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true },
    // The indexed relation — the only kind that produces graph edges.
    { key: 'related', type: 'relation', index: true, config: { collection: 'posts' } },
    // A non-indexed relation — must be INVISIBLE to the graph.
    { key: 'loose', type: 'relation', config: { collection: 'posts' } },
  ],
  workflow: { draftPublish: true },
};

describe('graphData — the visible relation graph', () => {
  let db: Database;
  let admin: Principal;
  let reader: Principal;
  let author: Principal;

  beforeEach(async () => {
    db = getDb(createTestD1());
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    reader = await makePrincipal(db, NOW, { id: 'prn_reader', role: 'reader' });
    author = await makePrincipal(db, NOW, { id: 'prn_author', role: 'author' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    await collectionsService.createCollection(db, admin, NOTES, NOW);
  });

  it('returns nodes with titles, derived scheduled status, and only indexed-relation edges', async () => {
    const post = await docs.createDocument(db, admin, 'posts', { title: 'The post' }, NOW);
    await docs.setPublished(db, admin, 'posts', post.id, true, NOW);
    const note = await docs.createDocument(
      db,
      admin,
      'notes',
      { title: 'The note', related: post.id, loose: post.id },
      NOW,
    );
    await docs.scheduleDocument(db, admin, 'notes', note.id, '2026-08-01T00:00:00Z', NOW);

    const g = await docs.graphData(db, admin, NOW);
    expect(g.truncated).toBe(false);
    expect(g.collections.map((c) => c.slug).sort()).toEqual(['notes', 'posts']);

    const postNode = g.nodes.find((n) => n.id === post.id);
    const noteNode = g.nodes.find((n) => n.id === note.id);
    expect(postNode).toMatchObject({ title: 'The post', collection: 'posts', status: 'published' });
    expect(noteNode?.status).toBe('scheduled'); // draft + pending publishAt

    // Exactly ONE edge — from the indexed relation. The non-indexed `loose`
    // relation has no index rows and therefore no edge.
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({
      source: note.id,
      target: post.id,
      collection: 'notes',
      fieldKey: 'related',
    });
  });

  it('drops edges whose endpoint the caller cannot see (published-only reader)', async () => {
    const post = await docs.createDocument(db, admin, 'posts', { title: 'Live post' }, NOW);
    await docs.setPublished(db, admin, 'posts', post.id, true, NOW);
    // The note stays DRAFT — invisible to a reader, so its edge must vanish.
    await docs.createDocument(db, admin, 'notes', { title: 'Draft note', related: post.id }, NOW);

    const g = await docs.graphData(db, reader, NOW);
    expect(g.nodes.map((n) => n.id)).toEqual([post.id]);
    expect(g.edges).toEqual([]);
  });

  it("an own-conditioned author sees their drafts, not anyone else's", async () => {
    await docs.createDocument(db, author, 'posts', { title: 'Mine' }, NOW);
    await docs.createDocument(db, admin, 'posts', { title: 'Not mine' }, NOW);

    const g = await docs.graphData(db, author, NOW);
    expect(g.nodes.map((n) => n.title)).toEqual(['Mine']);
  });

  it('caps clip the picture and say so (truncated), never silently', async () => {
    for (let i = 0; i < 4; i++) {
      const p = await docs.createDocument(db, admin, 'posts', { title: `P${i}` }, NOW);
      await docs.createDocument(db, admin, 'notes', { title: `N${i}`, related: p.id }, NOW);
    }

    const g = await docs.graphData(db, admin, NOW, { nodes: 3, edges: 2 });
    expect(g.nodes).toHaveLength(3);
    expect(g.truncated).toBe(true);
    expect(g.edges.length).toBeLessThanOrEqual(2);
    // Every surviving edge has both endpoints in the returned node set.
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('returns an empty (not failing) graph for a principal with no read anywhere', async () => {
    const nobody = await makePrincipal(db, NOW, { id: 'prn_nobody' });
    await docs.createDocument(db, admin, 'posts', { title: 'Hidden' }, NOW);

    const g = await docs.graphData(db, nobody, NOW);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.collections).toEqual([]);
  });
});
