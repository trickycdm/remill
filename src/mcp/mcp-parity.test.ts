/**
 * MCP parity tools (D29/D34): delete_<slug>, revisions_<slug>, restore_<slug>,
 * upload_media. Drives the real /mcp endpoint via app.request with a fake R2
 * bucket, proving visibility intersects permissions and handlers ride the same
 * services as admin/REST.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import * as access from '@/services/access';
import { listTrash } from '@/services/trash';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-04T12:00:00Z';

// A valid 1×1 transparent PNG — real magic bytes so sniffMime accepts it.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [
    { key: 'title', type: 'text', required: true, index: true, admin: { showInList: true } },
  ],
  workflow: { draftPublish: true },
};

describe('MCP parity — delete/revisions/restore/upload (D29/D34)', () => {
  let db: Database;
  let r2Puts: string[];
  let env: { DB: D1Database; MEDIA: R2Bucket; SESSION_SECRET: string; BASE_URL: string };
  let admin: Principal;
  let editorToken: string;
  let readerToken: string;

  async function mcp(token: string, method: string, params?: object) {
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      },
      env,
    );
    return (await res.json()) as {
      result?: { tools?: { name: string }[]; isError?: boolean; content?: { text: string }[] };
    };
  }
  async function call(token: string, name: string, args: object) {
    const r = await mcp(token, 'tools/call', { name, arguments: args });
    const payload = JSON.parse(r.result?.content?.[0]?.text ?? 'null');
    return { isError: r.result?.isError === true, payload };
  }

  async function tokenFor(name: string, role: string) {
    const pid = await access.createAgent(db, admin, name, NOW);
    await access.assignRole(db, admin, pid, role, '*', NOW);
    return (await access.issueToken(db, admin, { principalId: pid, name: 't' }, NOW)).token;
  }

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    r2Puts = [];
    const media = {
      put: async (key: string) => {
        r2Puts.push(key);
        return {};
      },
    } as unknown as R2Bucket;
    env = { DB: d1, MEDIA: media, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://test' };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    editorToken = await tokenFor('editor-bot', 'editor');
    readerToken = await tokenFor('reader-bot', 'reader');
  });

  it('tool visibility: editors get the parity tools, readers do not', async () => {
    const editorTools = (await mcp(editorToken, 'tools/list')).result!.tools!.map((t) => t.name);
    expect(editorTools).toEqual(
      expect.arrayContaining(['delete_posts', 'revisions_posts', 'restore_posts', 'upload_media']),
    );
    const readerTools = (await mcp(readerToken, 'tools/list')).result!.tools!.map((t) => t.name);
    expect(readerTools).toContain('revisions_posts'); // read-gated
    for (const hidden of ['delete_posts', 'restore_posts', 'upload_media']) {
      expect(readerTools).not.toContain(hidden);
    }
  });

  it('delete_<slug> moves to trash (recoverable), attributed to the agent', async () => {
    const created = await call(editorToken, 'create_posts', { title: 'Agent-deleted' });
    const del = await call(editorToken, 'delete_posts', { id: created.payload.id });
    expect(del.isError).toBe(false);
    expect(del.payload).toMatchObject({ deleted: true, recoverableDays: 30 });
    const trash = await listTrash(db, admin, {}, NOW);
    expect(trash.rows.map((r) => r.documentId)).toEqual([created.payload.id]);
  });

  it('revisions_<slug> + restore_<slug> round-trip over MCP', async () => {
    const created = await call(editorToken, 'create_posts', { title: 'v1' });
    await call(editorToken, 'update_posts', { id: created.payload.id, title: 'v2' });

    const revs = await call(editorToken, 'revisions_posts', { id: created.payload.id });
    expect(revs.payload.map((r: { revision: number }) => r.revision)).toEqual([2, 1]);

    const restored = await call(editorToken, 'restore_posts', { id: created.payload.id, revision: 1 });
    expect(restored.isError).toBe(false);
    expect(restored.payload.data.title).toBe('v1');
  });

  it('upload_media stores through the real service (sniff + alt) and hits R2', async () => {
    const up = await call(editorToken, 'upload_media', {
      filename: 'dot.png',
      alt: 'A single transparent pixel',
      content_base64: TINY_PNG_B64,
    });
    expect(up.isError).toBe(false);
    expect(up.payload.mime).toBe('image/png');
    expect(up.payload.url).toBe(`/media/${up.payload.id}`);
    expect(r2Puts).toHaveLength(1);
  });

  it('upload_media enforces alt-for-images and rejects bad base64 as structured errors', async () => {
    const noAlt = await call(editorToken, 'upload_media', { filename: 'x.png', content_base64: TINY_PNG_B64 });
    expect(noAlt.isError).toBe(true);
    expect(noAlt.payload.code).toBe('VALIDATION');

    const garbage = await call(editorToken, 'upload_media', {
      filename: 'x.png',
      alt: 'x',
      content_base64: '!!!not-base64!!!',
    });
    expect(garbage.isError).toBe(true);
    expect(garbage.payload.code).toBe('VALIDATION');
    expect(r2Puts).toHaveLength(0);
  });

  it('schedule_<slug> (D32): publish-gated visibility; set + cancel round-trip; exactly-one-arg rule', async () => {
    const editorTools = (await mcp(editorToken, 'tools/list')).result!.tools!.map((t) => t.name);
    expect(editorTools).toContain('schedule_posts');
    const readerTools = (await mcp(readerToken, 'tools/list')).result!.tools!.map((t) => t.name);
    expect(readerTools).not.toContain('schedule_posts');

    const created = await call(editorToken, 'create_posts', { title: 'Later' });
    const scheduled = await call(editorToken, 'schedule_posts', {
      id: created.payload.id,
      publish_at: '2030-01-01T12:00:00Z',
    });
    expect(scheduled.isError).toBe(false);
    expect(scheduled.payload.publishAt).toBe('2030-01-01T12:00:00Z');

    const cancelled = await call(editorToken, 'schedule_posts', { id: created.payload.id, cancel: true });
    expect(cancelled.isError).toBe(false);
    expect(cancelled.payload.publishAt).toBeNull();

    // Exactly one of publish_at / cancel — both and neither are validation errors.
    const neither = await call(editorToken, 'schedule_posts', { id: created.payload.id });
    expect(neither.isError).toBe(true);
    expect(neither.payload.code).toBe('VALIDATION');
    const both = await call(editorToken, 'schedule_posts', {
      id: created.payload.id,
      publish_at: '2030-01-01T12:00:00Z',
      cancel: true,
    });
    expect(both.isError).toBe(true);
    expect(both.payload.code).toBe('VALIDATION');
  });

  it('poll_events (D33): offered to every principal; returns pointer events with nextSince', async () => {
    for (const token of [editorToken, readerToken]) {
      expect((await mcp(token, 'tools/list')).result!.tools!.map((t) => t.name)).toContain('poll_events');
    }
    const created = await call(editorToken, 'create_posts', { title: 'Watched' });
    const poll = await call(editorToken, 'poll_events', { since: 0 });
    expect(poll.isError).toBe(false);
    const match = poll.payload.data.find(
      (e: { type: string; resource: string }) => e.type === 'document.created' && e.resource === created.payload.id,
    );
    expect(match).toBeTruthy();
    expect(match.collection).toBe('posts');
    expect(poll.payload.nextSince).toBeGreaterThan(0);

    // Incremental poll from nextSince is empty until something changes.
    const idle = await call(editorToken, 'poll_events', { since: poll.payload.nextSince });
    expect(idle.payload.data).toEqual([]);
    expect(idle.payload.nextSince).toBe(poll.payload.nextSince);
  });
});
