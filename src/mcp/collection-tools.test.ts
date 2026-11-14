/**
 * The fixed MCP tool surface (D65): document tools that take a `collection`,
 * replacing the per-collection generator. `gating-golden.json` is the tool list
 * that generator produced for the fixture in gating-fixture.ts, captured on the
 * commit before it was removed — the first test holds the new per-call check to
 * it, pair by pair.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGatingFixture,
  FIXTURE_PRINCIPALS,
  PROBE_SLUGS,
  NOW,
  type FixturePrincipal,
  type GatingFixture,
  type ToolCallResult,
} from '@/mcp/gating-fixture';
import { DOCUMENT_TOOL_NAMES, STATIC_TOOL_NAMES, retiredToolRedirect } from '@/mcp/tools';
import * as collectionsService from '@/services/collections';

const GOLDEN = JSON.parse(readFileSync(join(__dirname, 'gating-golden.json'), 'utf-8')) as Record<
  FixturePrincipal,
  string[]
>;

/** Retired per-collection verb → the document tool that replaced it. Spelled out
 *  here (not imported) so the test pins the mapping rather than echoing it. */
const REPLACED: Record<string, string> = {
  list: 'list_documents',
  search: 'search_documents',
  get: 'get_document',
  backlinks: 'get_backlinks',
  revisions: 'list_revisions',
  create: 'create_document',
  update: 'update_document',
  restore: 'restore_revision',
  delete: 'delete_document',
  publish: 'publish_document',
  schedule: 'schedule_document',
  visibility: 'set_visibility',
  share: 'share_document',
  share_link: 'create_share_link',
  comments: 'list_comments',
  comment: 'add_comment',
  reply_comment: 'reply_comment',
  resolve_comment: 'resolve_comment',
};

const PRINCIPALS = Object.keys(FIXTURE_PRINCIPALS) as FixturePrincipal[];
const STATIC = STATIC_TOOL_NAMES as readonly string[];

/** A refusal made by the MCP layer itself, before any service ran: the tool is
 *  not offered to this principal, or it is and the collection check failed
 *  (those carry `available`). Anything else — success, a validation error, a
 *  missing document, a service-level denial — got past the gate. */
const refusedAtTheGate = (r: ToolCallResult) =>
  r.isError &&
  (r.payload.available !== undefined || /^Unknown or unavailable tool/.test(r.payload.error ?? ''));

describe('MCP document tools — a fixed set taking `collection` (D65)', () => {
  let fx: GatingFixture;
  beforeAll(async () => {
    fx = await buildGatingFixture();
  });

  it('gating is equivalent to the per-collection generator it replaced', async () => {
    for (const who of PRINCIPALS) {
      const token = fx.tokens[who];
      const listed = await fx.toolNames(token);
      for (const [verb, tool] of Object.entries(REPLACED)) {
        // A slug paired with a verb can spell a static tool (`list` + `media`);
        // those were never document tools and still are not.
        const wasListed = (slug: string) =>
          !STATIC.includes(`${verb}_${slug}`) && GOLDEN[who].includes(`${verb}_${slug}`);
        const expected = PROBE_SLUGS.filter(wasListed);

        // Listed exactly when the old generator emitted it for some collection…
        expect(listed.includes(tool), `${who}: ${tool} listed`).toBe(expected.length > 0);
        for (const slug of PROBE_SLUGS) {
          const r = await fx.call(token, tool, { collection: slug });
          // …and let through to the service exactly where `<verb>_<slug>` existed.
          expect(!refusedAtTheGate(r), `${who}: ${tool} on ${slug}`).toBe(wasListed(slug));
          // What a refusal offers instead is that same set, never more.
          if (r.payload.available) expect(r.payload.available.sort()).toEqual([...expected].sort());
        }
      }
    }
  });

  it('the tool list is the same 33 names however many collections exist', async () => {
    const admin = fx.tokens.admin;
    const before = await fx.toolNames(admin);
    expect(before).toEqual([...STATIC_TOOL_NAMES, ...DOCUMENT_TOOL_NAMES].sort());
    expect(before).toHaveLength(33);
    // (The generator this replaced listed 102 tools for this same fixture.)
    expect(GOLDEN.admin).toHaveLength(102);

    const created = await fx.call(admin, 'create_collection', {
      definition: {
        slug: 'reading-list',
        name: 'Reading list',
        shape: 'collection',
        fields: [{ key: 'title', type: 'text', required: true }],
      },
    });
    expect(created.isError).toBe(false);
    expect(created.payload.note).toContain('"reading-list"');
    expect(created.payload.newTools).toBeUndefined();
    expect(await fx.toolNames(admin)).toEqual(before);

    // Usable in the same session — nothing to re-list, nothing to reconnect.
    const doc = await fx.call(admin, 'create_document', {
      collection: 'reading-list',
      data: { title: 'Seeing Like a State' },
    });
    expect(doc.isError).toBe(false);
    const listed = await fx.call(admin, 'list_documents', { collection: 'reading-list' });
    expect(listed.payload.total).toBe(1);
  });

  it('a hidden private collection and a nonexistent one get the same answer', async () => {
    // An editor on `reports` only: `secrets` is hidden. Most document tools are
    // listed for them (refused per collection); the few that are not are refused
    // as unknown tools — either way the two slugs must be indistinguishable.
    const token = fx.tokens.editorOnReports;
    const same = async (tool: string) => {
      const hidden = await fx.call(token, tool, { collection: 'secrets', id: 'doc_x' });
      const absent = await fx.call(token, tool, { collection: 'secretz', id: 'doc_x' });
      expect(hidden.isError, tool).toBe(true);
      expect(hidden.text.replaceAll('secrets', 'secretz'), tool).toBe(absent.text);
      expect(hidden.text, tool).not.toContain('missing');
      return hidden;
    };
    for (const tool of DOCUMENT_TOOL_NAMES) {
      const r = await same(tool);
      expect(r.payload.code).toBe('FORBIDDEN');
      expect(r.payload.available ?? []).not.toContain('secrets');
    }
    expect((await same('describe_collection')).payload.available).toEqual(
      expect.arrayContaining(['posts', 'reports']),
    );
    // The retired-name redirect is derived from the name alone — also no oracle.
    const text = async (name: string) => (await fx.call(token, name, { id: 'doc_x' })).text;
    expect((await text('get_secrets')).replaceAll('secrets', 'secretz')).toBe(await text('get_secretz'));
    // …and discovery agrees with all of the above.
    const listed = await fx.call(token, 'list_collections');
    expect(listed.text).not.toContain('secrets');
  });

  it('a known collection the tool cannot act on is refused with the reason', async () => {
    // Permission: an author may not publish — the structured denial names it.
    const denied = await fx.call(fx.tokens.editorOnReports, 'publish_document', {
      collection: 'posts',
      id: 'doc_x',
    });
    expect(denied.payload).toMatchObject({
      code: 'FORBIDDEN',
      missing: { action: 'publish', collection: 'posts' },
      available: ['reports'],
    });
    // Feature: `notes` has no lifecycle, whatever the caller may do.
    const noLifecycle = await fx.call(fx.tokens.admin, 'publish_document', { collection: 'notes', id: 'doc_x' });
    expect(noLifecycle.payload.code).toBe('BAD_REQUEST');
    expect(noLifecycle.payload.error).toContain('draft/published lifecycle');
    expect(noLifecycle.payload.available).toEqual(expect.arrayContaining(['posts', 'reports']));
    expect(noLifecycle.payload.available).not.toContain('notes');
  });

  it('media is never a document-tool target', async () => {
    for (const tool of DOCUMENT_TOOL_NAMES) {
      const r = await fx.call(fx.tokens.admin, tool, { collection: 'media', id: 'doc_x', data: {} });
      expect(refusedAtTheGate(r), tool).toBe(true);
      expect(r.payload.available, tool).not.toContain('media');
    }
    const described = await fx.call(fx.tokens.admin, 'describe_collection', { collection: 'media' });
    expect(described.payload.tools).toEqual([]);
  });

  it('list_collections is compact and says what the caller may do', async () => {
    const asAdmin = JSON.parse((await fx.call(fx.tokens.admin, 'list_collections')).text) as {
      slug: string;
      actions: string[];
      access?: unknown;
      fields: Record<string, unknown>[];
    }[];
    const posts = asAdmin.find((c) => c.slug === 'posts');
    expect(posts?.actions).toEqual(expect.arrayContaining(['read', 'create', 'publish', 'manage_schema']));
    // Even a schema manager gets the projection here; definitions are describe's job.
    expect(posts?.access).toBeUndefined();
    expect(posts?.fields[0]).toEqual({ key: 'title', type: 'text', required: true });

    const asReader = JSON.parse((await fx.call(fx.tokens.maskedReader, 'list_collections')).text) as {
      slug: string;
      actions: string[];
    }[];
    expect(asReader.find((c) => c.slug === 'posts')?.actions).toEqual(['read']);
    expect(asReader.find((c) => c.slug === 'notes')?.actions).toEqual([]);
    expect(asReader.map((c) => c.slug)).not.toContain('secrets');
  });

  it('describe_collection carries what the per-collection schemas did, to the same callers', async () => {
    const writer = (await fx.call(fx.tokens.editor, 'describe_collection', { collection: 'reports' })).payload;
    expect(writer.tools).toEqual(expect.arrayContaining(['create_document', 'add_comment', 'publish_document']));
    expect(writer.dataSchema).toMatchObject({
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    });
    expect(writer.indexedFields).toEqual(['title']);
    expect(writer.renders).toEqual(['review']);
    expect(writer.lifecycle).toBe(true);
    expect(writer.access).toBeUndefined(); // not a schema manager → the public projection

    const reader = (await fx.call(fx.tokens.maskedReader, 'describe_collection', { collection: 'reports' })).payload;
    expect(reader.tools).toEqual(['list_documents', 'search_documents', 'get_document', 'get_backlinks', 'list_revisions']);
    expect(reader.dataSchema).toBeUndefined();
    expect(reader.renders).toEqual([]);

    const noLifecycle = (await fx.call(fx.tokens.editor, 'describe_collection', { collection: 'notes' })).payload;
    expect(noLifecycle.lifecycle).toBe(false);
    expect(noLifecycle.tools).not.toContain('publish_document');

    // A schema manager sees the definition whole.
    const manager = (await fx.call(fx.tokens.builder, 'describe_collection', { collection: 'posts' })).payload;
    expect(manager.access).toEqual({ publicRead: true });

    // Create-only on a private collection: not in discovery, but the caller was
    // always shown `create_secrets` and its schema — so describe answers.
    const createOnly = fx.tokens.createOnlyOnPrivate;
    expect((await fx.call(createOnly, 'list_collections')).text).not.toContain('secrets');
    const described = (await fx.call(createOnly, 'describe_collection', { collection: 'secrets' })).payload;
    expect(described.tools).toEqual(['create_document']);
    expect(described.dataSchema).toBeTruthy();
    expect(described.indexedFields).toBeUndefined();
  });

  it('document fields travel under `data`, so a field may share a name with a tool argument', async () => {
    await collectionsService.createCollection(
      fx.db,
      fx.admin,
      {
        slug: 'tickets',
        name: 'Tickets',
        shape: 'collection',
        fields: [
          { key: 'title', type: 'text', required: true },
          { key: 'resolves', type: 'text' },
        ],
      },
      NOW,
    );
    const editor = fx.tokens.editor;
    const created = await fx.call(editor, 'create_document', {
      collection: 'tickets',
      data: { title: 'Fix login', resolves: 'issue 12' },
    });
    expect(created.payload.data).toMatchObject({ resolves: 'issue 12' });
    const updated = await fx.call(editor, 'update_document', {
      collection: 'tickets',
      id: created.payload.id,
      expectedRevision: created.payload.revision,
      data: { resolves: 'issue 13' },
    });
    expect(updated.payload.data).toMatchObject({ title: 'Fix login', resolves: 'issue 13' });

    // Fields at the top level (the pre-D65 shape) are refused, not silently dropped.
    const flat = await fx.call(editor, 'create_document', { collection: 'tickets', title: 'Nope' });
    expect(flat.payload).toMatchObject({ code: 'VALIDATION', details: [{ path: 'data' }] });
  });

  it('a validation failure on a write names the fields that do exist', async () => {
    const r = await fx.call(fx.tokens.editor, 'create_document', {
      collection: 'reports',
      data: { title: 'Q3', summary: 'not a field' },
    });
    expect(r.payload.code).toBe('VALIDATION');
    expect(r.payload.details).toEqual([expect.objectContaining({ path: 'summary' })]);
    expect(r.payload.hint).toContain('title (required), body');
    expect(r.payload.hint).toContain('describe_collection');
  });

  it('a retired per-collection name is answered with its replacement', async () => {
    const r = await fx.call(fx.tokens.editor, 'create_posts', { title: 'x' });
    expect(r.isError).toBe(true);
    expect(r.payload).toMatchObject({ code: 'TOOL_RENAMED', replacedBy: 'create_document' });
    expect(r.payload.error).toContain('collection: "posts"');
    expect(r.payload.error).toContain('`data`');

    for (const [verb, tool] of Object.entries(REPLACED)) {
      expect(retiredToolRedirect(`${verb}_reading-list`)?.replacedBy, verb).toBe(tool);
    }
    // Current names, hidden or not, and unrelated names are never "retired".
    for (const name of [...STATIC_TOOL_NAMES, ...DOCUMENT_TOOL_NAMES, 'frobnicate', 'get_', '_posts', 'get_Posts']) {
      expect(retiredToolRedirect(name), name).toBeNull();
    }
    // A reader is not offered create_collection: still the plain refusal.
    const hidden = await fx.call(fx.tokens.reader, 'create_collection', { definition: {} });
    expect(hidden.payload.code).toBe('FORBIDDEN');
  });

  it('initialize tells a client how the surface works', async () => {
    const r = await fx.mcp(fx.tokens.reader, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    expect(r.body.result.instructions).toContain('list_collections');
    expect(r.body.result.instructions).toContain('`collection`');
  });
});
