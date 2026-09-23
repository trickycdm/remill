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

  it('D54: update_<slug> with a stale expectedRevision is an isError STALE_REVISION result', async () => {
    const call = async (name: string, args: object) => {
      const r = await mcp(editorToken, 'tools/call', { name, arguments: args });
      return { isError: r.body.result.isError, payload: JSON.parse(r.body.result.content[0].text) };
    };
    const created = await call('create_posts', { title: 'Agent draft' });
    const id = created.payload.id;
    expect(created.payload.revision).toBe(1);

    const ok = await call('update_posts', { id, title: 'Agent v2', expectedRevision: 1 });
    expect(ok.isError).toBeFalsy();
    expect(ok.payload.revision).toBe(2);

    const stale = await call('update_posts', { id, title: 'Agent stale', expectedRevision: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.payload.code).toBe('STALE_REVISION');

    const got = await call('get_posts', { id });
    expect(got.payload.data.title).toBe('Agent v2');
  });

  it('D55: the agent review loop — comment, read the review brief, save with resolves', async () => {
    await collectionsService.createCollection(
      db,
      admin,
      {
        slug: 'reports',
        name: 'Reports',
        shape: 'collection',
        fields: [
          { key: 'title', type: 'text', required: true },
          { key: 'page', type: 'html' },
        ],
      },
      NOW,
    );
    const rpc = async (token: string, name: string, args: object) => {
      const r = await mcp(token, 'tools/call', { name, arguments: args });
      const text = r.body.result.content[0].text as string;
      return { isError: r.body.result.isError === true, text };
    };
    const json = async (name: string, args: object) => JSON.parse((await rpc(editorToken, name, args)).text);

    // Tools exist for a commenter on an annotatable collection, not for a reader.
    expect(toolNames(await mcp(editorToken, 'tools/list'))).toEqual(
      expect.arrayContaining(['comments_reports', 'comment_reports', 'reply_comment_reports', 'resolve_comment_reports']),
    );
    expect(toolNames(await mcp(readerToken, 'tools/list'))).not.toContain('comment_reports');
    expect(toolNames(await mcp(editorToken, 'tools/list'))).not.toContain('comment_posts'); // no annotatable field

    const doc = await json('create_reports', { title: 'Q3', page: '<p>Revenue grew 12% in Q3.</p>' });
    const thread = await json('comment_reports', {
      id: doc.id,
      quote: 'grew 12%',
      body: 'Cite the source',
      intent: 'must_fix',
    });
    expect(thread.root.anchor).toMatchObject({ kind: 'text', field: 'page', quote: 'grew 12%' });

    const brief = await rpc(editorToken, 'get_reports', { id: doc.id, render: 'review' });
    expect(brief.isError).toBe(false);
    expect(brief.text).toContain('# Review: Q3');
    expect(brief.text).toContain('{==grew 12%==}');
    expect(brief.text).toContain(`threadId: ${thread.root.id}`);

    // A bad thread id fails the whole call BEFORE the save.
    const bad = await rpc(editorToken, 'update_reports', {
      id: doc.id,
      expectedRevision: 1,
      page: '<p>Revenue grew 12% in Q3 (source: finance).</p>',
      resolves: ['cmt_nope'],
    });
    expect(bad.isError).toBe(true);
    expect((await json('get_reports', { id: doc.id })).revision).toBe(1);

    const saved = await json('update_reports', {
      id: doc.id,
      expectedRevision: 1,
      page: '<p>Revenue grew 12% in Q3 (source: finance).</p>',
      resolves: [thread.root.id],
    });
    expect(saved).toMatchObject({ revision: 2, resolvedThreads: [thread.root.id] });
    const [after] = await json('comments_reports', { id: doc.id });
    expect(after.root).toMatchObject({ status: 'resolved', resolvedRevision: 2 });
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

  it('D47 collab + text renders: render args advertised only where declared; markdown comes back literal', async () => {
    const adminToken = await tokenFor('collab-admin', 'admin');
    const installed = await mcp(adminToken, 'tools/call', {
      name: 'install_pack',
      arguments: { pack: 'collab' },
    });
    expect(installed.body.result.isError).toBeFalsy();

    // Render-declaring templates ('warp') advertise their renders; any collection
    // with annotatable fields adds `review` (D55) for principals who may comment.
    // `posts` here has only a text field — nothing to render.
    type ToolRow = {
      name: string;
      inputSchema: { properties: Record<string, { enum?: string[] } | undefined> };
    };
    const tools = (await mcp(adminToken, 'tools/list')).body.result.tools as ToolRow[];
    expect(tools.find((t) => t.name === 'get_warps')?.inputSchema.properties.render?.enum).toEqual(
      ['reviewer', 'implementer', 'review'],
    );
    expect(tools.find((t) => t.name === 'get_posts')?.inputSchema.properties.render).toBeUndefined();
    // lifecycle:'none' working data — no publish ceremony offered.
    expect(tools.map((t) => t.name)).not.toContain('publish_tasks');

    const task = await mcp(adminToken, 'tools/call', {
      name: 'create_tasks',
      arguments: { title: 'CSV export', goal: 'Ship the export.', stage: 'building' },
    });
    const taskId = JSON.parse(task.body.result.content[0].text).id as string;

    // The 422 beat: a lazy warp (no open questions) is rejected at write time.
    const lazy = await mcp(adminToken, 'tools/call', {
      name: 'create_warps',
      arguments: { title: 'Lazy', task: taskId, state: 'stuff', next_action: 'more stuff' },
    });
    expect(lazy.body.result.isError).toBe(true);
    expect(lazy.body.result.content[0].text).toContain('open_questions');

    const warp = await mcp(adminToken, 'tools/call', {
      name: 'create_warps',
      arguments: {
        title: 'Session 1',
        task: taskId,
        written_as: 'implementer',
        state: 'Streaming export works on the happy path.',
        open_questions: '- viewer locale or invoice locale?',
        next_action: 'Wire the UI button.',
        code: { branch: 'feat/csv-export' },
      },
    });
    const warpId = JSON.parse(warp.body.result.content[0].text).id as string;

    // A render comes back as LITERAL markdown — no JSON quoting (D47 passthrough).
    const rendered = await mcp(adminToken, 'tools/call', {
      name: 'get_warps',
      arguments: { id: warpId, render: 'implementer', budget: 500 },
    });
    const text = rendered.body.result.content[0].text as string;
    expect(text.startsWith('# Session 1')).toBe(true);
    expect(text).toContain('\n## Next action');
    expect(text).toContain('CSV export'); // the owning task, expanded by title

    // Unknown render → structured 422 listing what IS available.
    const bad = await mcp(adminToken, 'tools/call', {
      name: 'get_warps',
      arguments: { id: warpId, render: 'bogus' },
    });
    expect(bad.body.result.isError).toBe(true);
    expect(bad.body.result.content[0].text).toContain('reviewer, implementer');

    // Without `render`, the plain JSON read is unchanged.
    const plain = await mcp(adminToken, 'tools/call', {
      name: 'get_warps',
      arguments: { id: warpId },
    });
    expect(JSON.parse(plain.body.result.content[0].text).id).toBe(warpId);
  });

  it('D50: visibility_<slug> — gated like publish (editor yes, reader no), happy path, and 403 audited', async () => {
    const editor = toolNames(await mcp(editorToken, 'tools/list'));
    expect(editor).toContain('visibility_posts');
    const reader = toolNames(await mcp(readerToken, 'tools/list'));
    expect(reader).not.toContain('visibility_posts');

    const create = await mcp(editorToken, 'tools/call', {
      name: 'create_posts',
      arguments: { title: 'Visible or not' },
    });
    const doc = JSON.parse(create.body.result.content[0].text);

    const set = await mcp(editorToken, 'tools/call', {
      name: 'visibility_posts',
      arguments: { id: doc.id, visibility: 'unlisted' },
    });
    expect(set.body.result.isError).toBeFalsy();
    const updated = JSON.parse(set.body.result.content[0].text);
    expect(updated.visibility).toBe('unlisted');

    // Calling it isn't even discoverable for a reader — refused without a
    // service call (same discovery-time denial shape as publish_posts).
    const denied = await mcp(readerToken, 'tools/call', {
      name: 'visibility_posts',
      arguments: { id: doc.id, visibility: 'private' },
    });
    expect(denied.body.result.isError).toBe(true);
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

  it('D48: anonymous /mcp gets the 401 OAuth challenge (no anonymous surface)', async () => {
    const r = await mcp(null, 'tools/list');
    expect(r.status).toBe(401);
  });

  it('SEC-5: reader list_collections returns a public-safe projection (no access/workflow)', async () => {
    const r = await mcp(readerToken, 'tools/call', { name: 'list_collections' });
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

  it('D46: a private collection is invisible over MCP to wrongly-scoped tokens', async () => {
    await collectionsService.createCollection(
      db,
      admin,
      { ...POSTS, slug: 'secret', name: 'Secret', access: { private: true } },
      NOW,
    );

    const slugsFor = async (token: string | null) =>
      (
        JSON.parse(
          (await mcp(token, 'tools/call', { name: 'list_collections' })).body.result.content[0]
            .text,
        ) as { slug: string }[]
      ).map((c) => c.slug);

    // (Anonymous can no longer reach /mcp at all — D48's 401 challenge — so
    // the anonymous-invisibility half of D46 holds a fortiori.)
    // A reader token is role-wide ('*' assignment) so it CAN discover it; an
    // admin token sees the full definition path. The interesting negative is a
    // scoped agent: wildcard reader role masked by a posts-only token scope.
    const maskedPid = await access.createAgent(db, admin, 'masked-bot', NOW);
    await access.assignRole(db, admin, maskedPid, 'reader', '*', NOW);
    const maskedToken = (
      await access.issueToken(
        db,
        admin,
        { principalId: maskedPid, name: 't', scope: [{ collection: 'posts', action: 'read' }] },
        NOW,
      )
    ).token;
    expect(await slugsFor(maskedToken)).not.toContain('secret');

    const adminToken = await tokenFor('schema-bot', 'admin');
    expect(await slugsFor(adminToken)).toContain('secret');

    // Pack installed-status is caller-scoped the same way (D46).
    await collectionsService.installPack(db, admin, 'prompts', NOW);
    const installedFor = async (token: string | null) =>
      (
        JSON.parse(
          (await mcp(token, 'tools/call', { name: 'list_packs' })).body.result.content[0].text,
        ) as { key: string; installed: boolean }[]
      ).find((p) => p.key === 'prompts')?.installed;
    expect(await installedFor(adminToken)).toBe(true);
    // The masked reader can't see the pack's private collection → reads as not installed.
    expect(await installedFor(maskedToken)).toBe(false);
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

  describe('prompts primitive (D44) — prompt-shaped collections as native MCP prompts', () => {
    async function seedPrompt() {
      const { createDocument, setPublished } = await import('@/services/documents');
      await collectionsService.installPack(db, admin, 'prompts', NOW);
      const doc = await createDocument(
        db,
        admin,
        'prompts',
        {
          title: 'Release drafter',
          body: 'Notes for {{version}} aimed at {{audience}}.',
          variables: ['version'],
          model: 'claude',
          notes: 'Run after tagging.',
        },
        NOW,
      );
      await setPublished(db, admin, 'prompts', doc.id, true, NOW);
      // A draft sibling that must never surface.
      await createDocument(db, admin, 'prompts', { title: 'Half-baked', body: 'wip' }, NOW);
      return doc;
    }

    it('initialize advertises the prompts capability', async () => {
      const r = await mcp(editorToken, 'initialize', { protocolVersion: '2024-11-05' });
      expect(r.body.result.capabilities.prompts).toBeTruthy();
    });

    it('prompts/list: published items with declared ∪ scanned arguments; drafts absent', async () => {
      await seedPrompt();
      const r = await mcp(readerToken, 'prompts/list');
      const prompts = r.body.result.prompts as {
        name: string;
        description?: string;
        arguments: { name: string; required: boolean }[];
      }[];
      expect(prompts).toHaveLength(1); // the draft never surfaces
      expect(prompts[0].name).toBe('prompts/release-drafter');
      expect(prompts[0].description).toContain('Release drafter');
      // declared ['version'] first, then scanned-only 'audience'.
      expect(prompts[0].arguments).toEqual([
        { name: 'version', required: false },
        { name: 'audience', required: false },
      ]);
    });

    it('prompts/list is permission-filtered: scope-masked tokens see [] (anonymous is 401, D48)', async () => {
      await seedPrompt();
      const anon = await mcp(null, 'prompts/list');
      expect(anon.status).toBe(401);

      // A reader-role agent whose TOKEN is masked to posts-only: role would
      // allow, the scope mask must not.
      const pid = await access.createAgent(db, admin, 'masked-bot', NOW);
      await access.assignRole(db, admin, pid, 'reader', '*', NOW);
      const masked = (
        await access.issueToken(
          db,
          admin,
          { principalId: pid, name: 't', scope: [{ collection: 'posts', action: 'read' }] },
          NOW,
        )
      ).token;
      const r = await mcp(masked, 'prompts/list');
      expect(r.body.result.prompts).toEqual([]);
    });

    it('prompts/get interpolates arguments; missing args stay verbatim; $-patterns survive', async () => {
      await seedPrompt();
      const r = await mcp(readerToken, 'prompts/get', {
        name: 'prompts/release-drafter',
        arguments: { version: "$&1.2.3$'" },
      });
      const msg = r.body.result.messages[0];
      expect(msg.role).toBe('user');
      expect(msg.content.text).toBe("Notes for $&1.2.3$' aimed at {{audience}}.");
      expect(r.body.result.description).toContain('Run after tagging.');
    });

    it('prompts/get resolves the doc_id name form', async () => {
      const doc = await seedPrompt();
      const r = await mcp(readerToken, 'prompts/get', { name: `prompts/${doc.id}` });
      expect(r.body.result.messages[0].content.text).toContain('Notes for {{version}}');
    });

    it('prompts/get: unknown names, non-prompt collections, and drafts are ONE -32602 shape', async () => {
      await seedPrompt();
      const unknown = await mcp(readerToken, 'prompts/get', { name: 'prompts/nope' });
      expect(unknown.body.error.code).toBe(-32602);
      const nonPrompt = await mcp(readerToken, 'prompts/get', { name: 'posts/anything' });
      expect(nonPrompt.body.error.code).toBe(-32602);
      const malformed = await mcp(readerToken, 'prompts/get', { name: 'no-slash' });
      expect(malformed.body.error.code).toBe(-32602);
    });
  });
});
