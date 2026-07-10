import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { seedRoles, makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import * as access from '@/services/access';
import { recentAudit } from '@/db/queries/audit';
import type { Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

const NOW = '2026-07-04T12:00:00Z';

const POSTS: CollectionDefinition = {
  slug: 'posts',
  name: 'Posts',
  shape: 'collection',
  fields: [{ key: 'title', type: 'text', required: true, index: true }],
  workflow: { draftPublish: true },
  access: { publicRead: true },
};

describe('MCP server — generated, permission-filtered tools (Phase 7)', () => {
  let db: Database;
  let env: { DB: D1Database; MEDIA: R2Bucket; SESSION_SECRET: string; BASE_URL: string };
  let admin: Principal;
  let editorToken: string;
  let authorToken: string;
  let readerToken: string;

  async function mcp(token: string | null, method: string, params?: object, id: number | null = 1) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await app.request(
      '/mcp',
      { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) },
      env,
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const toolNames = (listResult: { body: { result: { tools: { name: string }[] } } }) =>
    listResult.body.result.tools.map((t) => t.name);

  async function tokenFor(name: string, role: string) {
    const pid = await access.createAgent(db, admin, name, NOW);
    await access.assignRole(db, admin, pid, role, '*', NOW);
    return (await access.issueToken(db, admin, { principalId: pid, name: 't' }, NOW)).token;
  }

  beforeEach(async () => {
    const d1 = createTestD1();
    db = getDb(d1);
    env = {
      DB: d1,
      MEDIA: {} as R2Bucket,
      SESSION_SECRET: 'x'.repeat(32),
      BASE_URL: 'http://test',
    };
    await seedRoles(db, NOW);
    admin = await makePrincipal(db, NOW, { id: 'prn_admin', role: 'admin' });
    await collectionsService.createCollection(db, admin, POSTS, NOW);
    editorToken = await tokenFor('editor-bot', 'editor');
    authorToken = await tokenFor('author-bot', 'author');
    readerToken = await tokenFor('reader-bot', 'reader');
  });

  it('initialize returns the protocol handshake', async () => {
    const r = await mcp(editorToken, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
    });
    expect(r.body.result.serverInfo.name).toBe('remill');
    expect(r.body.result.capabilities.tools).toBeTruthy();
  });

  it('tools are generated per collection and intersected with permissions', async () => {
    const editor = toolNames(await mcp(editorToken, 'tools/list'));
    expect(editor).toEqual(
      expect.arrayContaining([
        'list_posts',
        'get_posts',
        'create_posts',
        'update_posts',
        'publish_posts',
      ]),
    );

    // An author sees create/update but NOT publish, and NOT schema management.
    const author = toolNames(await mcp(authorToken, 'tools/list'));
    expect(author).toContain('create_posts');
    expect(author).not.toContain('publish_posts');
    expect(author).not.toContain('create_collection');

    // A reader sees only read tools.
    const reader = toolNames(await mcp(readerToken, 'tools/list'));
    expect(reader).toEqual(expect.arrayContaining(['list_posts', 'get_posts']));
    expect(reader).not.toContain('create_posts');

    // An admin (schema rights) sees create_collection.
    // (admin has no token here; verify via editor lacking it and the tool existing for manage_schema)
    expect(editor).not.toContain('create_collection'); // editor lacks manage_schema
  });

  it('an agent can create a collection and documents through generated tools', async () => {
    const adminToken = await tokenFor('admin-bot', 'admin');
    const created = await mcp(adminToken, 'tools/call', {
      name: 'create_collection',
      arguments: {
        definition: {
          slug: 'notes',
          name: 'Notes',
          shape: 'collection',
          fields: [{ key: 'body', type: 'text', required: true }],
        },
      },
    });
    expect(created.body.result.isError).toBeFalsy();

    // The new collection's tools now exist for this principal.
    const names = toolNames(await mcp(adminToken, 'tools/list'));
    expect(names).toContain('create_notes');

    const doc = await mcp(adminToken, 'tools/call', {
      name: 'create_notes',
      arguments: { body: 'first note' },
    });
    const payload = JSON.parse(doc.body.result.content[0].text);
    expect(payload.data.body).toBe('first note');
  });

  it('D42 marketplace: packs/templates discoverable by all; install_pack gated + full agent flow', async () => {
    // Discovery is ungated: even a reader sees both registries — but not install.
    const reader = toolNames(await mcp(readerToken, 'tools/list'));
    expect(reader).toEqual(expect.arrayContaining(['list_templates', 'list_packs']));
    expect(reader).not.toContain('install_pack');

    const tpls = await mcp(readerToken, 'tools/call', { name: 'list_templates', arguments: {} });
    const tplList = JSON.parse(tpls.body.result.content[0].text) as { key: string }[];
    expect(tplList.map((t) => t.key)).toContain('article');

    const packs = await mcp(readerToken, 'tools/call', { name: 'list_packs', arguments: {} });
    type PackRow = { key: string; installed: boolean; collections: { slug: string }[] };
    const blog = (JSON.parse(packs.body.result.content[0].text) as PackRow[]).find(
      (p) => p.key === 'blog',
    );
    expect(blog?.installed).toBe(false);
    expect(blog?.collections.map((c) => c.slug)).toEqual(['articles']);

    // Install requires manage_schema: an editor's direct call is refused.
    const denied = await mcp(editorToken, 'tools/call', {
      name: 'install_pack',
      arguments: { pack: 'blog' },
    });
    expect(denied.body.result.isError).toBe(true);

    // The headline agent flow: list_packs → install_pack → create_articles.
    const adminToken = await tokenFor('admin-bot', 'admin');
    const installed = await mcp(adminToken, 'tools/call', {
      name: 'install_pack',
      arguments: { pack: 'blog' },
    });
    expect(installed.body.result.isError).toBeFalsy();

    const names = toolNames(await mcp(adminToken, 'tools/list'));
    expect(names).toContain('create_articles');
    const doc = await mcp(adminToken, 'tools/call', {
      name: 'create_articles',
      arguments: { title: 'First post', body: 'Written into a pack-installed collection.' },
    });
    expect(doc.body.result.isError).toBeFalsy();

    // Installed status flips; a repeat install is a structured conflict.
    const after = await mcp(adminToken, 'tools/call', { name: 'list_packs', arguments: {} });
    expect(
      (JSON.parse(after.body.result.content[0].text) as PackRow[]).find((p) => p.key === 'blog')
        ?.installed,
    ).toBe(true);
    const again = await mcp(adminToken, 'tools/call', {
      name: 'install_pack',
      arguments: { pack: 'blog' },
    });
    expect(again.body.result.isError).toBe(true);
  });

  it('AGENTIC GOVERNANCE: an author drafts but cannot publish — denial is structured and audited', async () => {
    // Author creates a draft via the generated tool (allowed).
    const create = await mcp(authorToken, 'tools/call', {
      name: 'create_posts',
      arguments: { title: 'Draft by agent' },
    });
    const doc = JSON.parse(create.body.result.content[0].text);
    expect(doc.status).toBe('draft');

    // The author has no publish tool over MCP — calling it is refused at discovery
    // with a structured FORBIDDEN payload (no service call, so nothing to audit).
    const viaMcp = await mcp(authorToken, 'tools/call', {
      name: 'publish_posts',
      arguments: { id: doc.id, publish: true },
    });
    expect(viaMcp.body.result.isError).toBe(true);

    // Going around MCP to the RAW REST API, the server still denies publish — and
    // THAT reaches authorize(), so the denial is audited (surface 'rest').
    const rawPublish = await app.request(
      `/api/c/posts/${doc.id}/publish`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${authorToken}`, 'Content-Type': 'application/json' },
        body: '{"publish":true}',
      },
      env,
    );
    expect(rawPublish.status).toBe(403);

    // A human (admin) publishes it — "agent drafts, human publishes" falls out of
    // the permission model, no workflow engine required.
    const { setPublished } = await import('@/services/documents');
    const published = await setPublished(db, admin, 'posts', doc.id, true, NOW);
    expect(published.status).toBe('published');

    // The whole story is in the audit log: the agent's MCP create (allow), the
    // agent's raw-API publish (deny), and the human's publish (allow).
    const audit = await recentAudit(db, 1000);
    const mcpCreate = audit.find(
      (a) => a.surface === 'mcp' && a.action === 'create' && a.allowed === 1,
    );
    const restDeny = audit.find(
      (a) => a.surface === 'rest' && a.action === 'publish' && a.allowed === 0,
    );
    expect(mcpCreate).toBeTruthy();
    expect(restDeny).toBeTruthy();
    expect(restDeny?.principalId).toMatch(/^prn_/);
  });

  it('an unknown/unavailable tool is refused without leaking its existence', async () => {
    const r = await mcp(readerToken, 'tools/call', {
      name: 'publish_posts',
      arguments: { id: 'x' },
    });
    expect(r.body.result.isError).toBe(true);
  });

  it('SEC-5: anonymous list_collections returns a public-safe projection (no access/workflow)', async () => {
    const r = await mcp(null, 'tools/call', { name: 'list_collections' });
    const payload = JSON.parse(r.body.result.content[0].text) as {
      slug: string;
      access?: unknown;
      workflow?: unknown;
    }[];
    const posts = payload.find((c) => c.slug === 'posts');
    expect(posts).toBeTruthy();
    expect(posts?.access).toBeUndefined();
    expect(posts?.workflow).toBeUndefined();
  });

  it('share_<slug> supports team subjects; list_teams resolves names (manage_access only)', async () => {
    const adminToken = await tokenFor('sharer-bot', 'admin');
    const teamId = await access.createTeam(db, admin, { name: 'Tech team' }, NOW);
    const member = await makePrincipal(db, NOW, { id: 'prn_tm', role: 'reader' });
    await access.addTeamMember(db, admin, teamId, member.id, NOW);

    // Visibility: list_teams and share_posts require manage_access.
    const adminTools = toolNames(await mcp(adminToken, 'tools/list'));
    expect(adminTools).toEqual(expect.arrayContaining(['list_teams', 'share_posts']));
    const editorTools = toolNames(await mcp(editorToken, 'tools/list'));
    expect(editorTools).not.toContain('list_teams');
    expect(editorTools).not.toContain('share_posts');

    // The agent resolves "the tech team" by name, then grants it read on a draft.
    const teams = JSON.parse(
      (await mcp(adminToken, 'tools/call', { name: 'list_teams' })).body.result.content[0].text,
    ) as {
      id: string;
      name: string;
    }[];
    expect(teams.find((t) => t.name === 'Tech team')?.id).toBe(teamId);

    const draft = await mcp(adminToken, 'tools/call', {
      name: 'create_posts',
      arguments: { title: 'Team-shared draft' },
    });
    const doc = JSON.parse(draft.body.result.content[0].text);

    const grant = await mcp(adminToken, 'tools/call', {
      name: 'share_posts',
      arguments: { id: doc.id, subjectKind: 'team', subjectId: teamId, actions: ['read'] },
    });
    expect(grant.body.result.isError).toBeFalsy();

    // The member can now read the draft through the gated pipeline.
    const { getDocument } = await import('@/services/documents');
    const seen = await getDocument(db, member, 'posts', doc.id, NOW);
    expect(seen.data.title).toBe('Team-shared draft');
  });

  it('share_link_<slug> (D26): visible only with share_link; mints a clamped, resolvable URL', async () => {
    // Visibility intersects with the role: editor holds share_link, reader/author do not.
    expect(toolNames(await mcp(editorToken, 'tools/list'))).toContain('share_link_posts');
    expect(toolNames(await mcp(readerToken, 'tools/list'))).not.toContain('share_link_posts');
    expect(toolNames(await mcp(authorToken, 'tools/list'))).not.toContain('share_link_posts');

    const create = await mcp(editorToken, 'tools/call', {
      name: 'create_posts',
      arguments: { title: 'Linked from MCP' },
    });
    const doc = JSON.parse(create.body.result.content[0].text);

    // Missing/garbage expiry is a structured validation error.
    const bad = await mcp(editorToken, 'tools/call', {
      name: 'share_link_posts',
      arguments: { id: doc.id, expiresAt: 'soon' },
    });
    expect(bad.body.result.isError).toBe(true);

    // A far-future expiry is clamped to ≤ 30 days; the URL uses the threaded base.
    const minted = await mcp(editorToken, 'tools/call', {
      name: 'share_link_posts',
      arguments: { id: doc.id, expiresAt: '2036-01-01T00:00:00Z' },
    });
    const payload = JSON.parse(minted.body.result.content[0].text) as {
      grantId: string;
      url: string;
      expiresAt: string;
    };
    expect(payload.url).toMatch(/^http:\/\/test\/s\/rms_/);
    // Clamped to ~30 days from the server clock (the route injects real time) —
    // nowhere near the requested 2036.
    const clampMs = Date.parse(payload.expiresAt) - Date.now();
    expect(clampMs).toBeGreaterThan(0);
    expect(clampMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 60_000);

    // The minted link resolves and serves the (draft) document to a link-holder.
    const token = payload.url.split('/s/')[1];
    const { resolveShareLink } = await import('@/services/access');
    const { getSharedDocument } = await import('@/services/documents');
    const grant = await resolveShareLink(db, token, NOW);
    expect(grant?.documentId).toBe(doc.id);
    const shared = await getSharedDocument(db, grant!, NOW);
    expect(shared.doc.data.title).toBe('Linked from MCP');
  });
});
