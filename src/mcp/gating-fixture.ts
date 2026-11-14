/**
 * Shared fixture for the MCP gating tests (D65): a seeded database with one
 * collection per gating axis (lifecycle, publicRead, annotatable fields,
 * `access.private`, the built-ins) and one token per principal shape (role on
 * `*`, role on one collection, token scope masks, no role at all).
 *
 * `gating-golden.json` was captured from the per-collection tool generator
 * BEFORE the fixed tool set replaced it; the equivalence test replays this
 * fixture against it, so a principal/collection pair may only be added here
 * together with a justified edit to that file.
 */

import { app } from '@/main';
import { createTestD1 } from '@/test/d1';
import { getDb, type Database } from '@/db/client';
import { makePrincipal } from '@/test/access';
import * as collectionsService from '@/services/collections';
import * as access from '@/services/access';
import type { Action, Principal } from '@/access';
import type { CollectionDefinition } from '@/fields/types';

export const NOW = '2026-07-04T12:00:00Z';

const def = (d: Omit<CollectionDefinition, 'shape'>): CollectionDefinition => ({
  shape: 'collection',
  ...d,
});

/** One collection per gating axis. The seed adds `settings`, `media`, `pages`. */
export const FIXTURE_COLLECTIONS: readonly CollectionDefinition[] = [
  def({
    slug: 'posts',
    name: 'Posts',
    fields: [{ key: 'title', type: 'text', required: true, index: true }],
    workflow: { draftPublish: true },
    access: { publicRead: true },
  }),
  def({
    slug: 'reports',
    name: 'Reports',
    fields: [
      { key: 'title', type: 'text', required: true, index: true },
      { key: 'body', type: 'markdown' },
    ],
    workflow: { draftPublish: true },
  }),
  def({
    slug: 'notes',
    name: 'Notes',
    fields: [
      { key: 'title', type: 'text', required: true },
      { key: 'body', type: 'markdown' },
    ],
    workflow: { lifecycle: 'none' },
  }),
  def({
    slug: 'secrets',
    name: 'Secrets',
    fields: [{ key: 'title', type: 'text', required: true }],
    workflow: { draftPublish: true },
    access: { private: true },
  }),
];

/** Every slug the equivalence test probes: the fixture's, the built-ins, and one
 *  that does not exist. */
export const PROBE_SLUGS = [
  ...FIXTURE_COLLECTIONS.map((d) => d.slug),
  'settings',
  'media',
  'pages',
  'nope',
] as const;

type Scope = { collection: string; action: Action }[];

interface PrincipalSpec {
  readonly role?: string;
  readonly on?: string;
  readonly scope?: Scope;
}

const on = (collection: string, ...actions: Action[]): Scope =>
  actions.map((action) => ({ collection, action }));

export const FIXTURE_PRINCIPALS = {
  admin: { role: 'admin' },
  builder: { role: 'builder' },
  editor: { role: 'editor' },
  editorOnReports: { role: 'editor', on: 'reports' },
  author: { role: 'author' },
  reader: { role: 'reader' },
  maskedReader: { role: 'editor', scope: [...on('posts', 'read'), ...on('reports', 'read')] },
  createOnlyOnPrivate: { role: 'editor', scope: on('secrets', 'create') },
  editorWithoutComment: {
    role: 'editor',
    scope: on('*', 'read', 'create', 'update', 'delete', 'publish', 'share_link'),
  },
  outsider: {},
} as const satisfies Record<string, PrincipalSpec>;

export type FixturePrincipal = keyof typeof FIXTURE_PRINCIPALS;

/** The JSON-RPC envelope as far as these tests read it. */
export interface McpResponse {
  readonly status: number;
  readonly body: {
    readonly result: {
      readonly tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[];
      readonly content?: { type: string; text: string }[];
      readonly isError?: boolean;
      readonly [key: string]: unknown;
    };
  };
}

/** A tool result's JSON, as far as these tests read it: the error envelope's
 *  known keys, and anything else a tool returns. */
export interface ToolPayload {
  readonly code?: string;
  readonly error?: string;
  readonly hint?: string;
  readonly available?: string[];
  readonly missing?: { action: string; collection?: string };
  readonly [key: string]: unknown;
}

export interface ToolCallResult {
  readonly isError: boolean;
  /** The single text block, verbatim. */
  readonly text: string;
  /** `text` parsed as a JSON object; `{}` for a literal-text result (a D47 render)
   *  or a JSON array — read `text` for those. */
  readonly payload: ToolPayload;
}

export interface GatingFixture {
  readonly db: Database;
  readonly admin: Principal;
  readonly tokens: Record<FixturePrincipal, string>;
  mcp(token: string, method: string, params?: object): Promise<McpResponse>;
  toolNames(token: string): Promise<string[]>;
  call(token: string, name: string, args?: object): Promise<ToolCallResult>;
}

function parsePayload(text: string): ToolPayload {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ToolPayload)
      : {};
  } catch {
    return {};
  }
}

export async function buildGatingFixture(): Promise<GatingFixture> {
  const d1 = createTestD1({ seed: true });
  const db = getDb(d1);
  const env = { DB: d1, MEDIA: {} as R2Bucket, SESSION_SECRET: 'x'.repeat(32), BASE_URL: 'http://test' };
  const admin = await makePrincipal(db, NOW, { id: 'prn_fixture_admin', role: 'admin' });
  for (const d of FIXTURE_COLLECTIONS) await collectionsService.createCollection(db, admin, d, NOW);

  const tokens = {} as Record<FixturePrincipal, string>;
  for (const [key, spec] of Object.entries(FIXTURE_PRINCIPALS) as [FixturePrincipal, PrincipalSpec][]) {
    const pid = await access.createAgent(db, admin, `${key}-bot`, NOW);
    if (spec.role) await access.assignRole(db, admin, pid, spec.role, spec.on ?? '*', NOW);
    const issued = await access.issueToken(db, admin, { principalId: pid, name: 't', scope: spec.scope }, NOW);
    tokens[key] = issued.token;
  }

  const mcp: GatingFixture['mcp'] = async (token, method, params) => {
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      },
      env,
    );
    return { status: res.status, body: (await res.json()) as McpResponse['body'] };
  };

  return {
    db,
    admin,
    tokens,
    mcp,
    toolNames: async (token) =>
      ((await mcp(token, 'tools/list')).body.result.tools ?? []).map((t) => t.name).sort(),
    call: async (token, name, args = {}) => {
      const { result } = (await mcp(token, 'tools/call', { name, arguments: args })).body;
      const text = result.content?.[0]?.text ?? '';
      return { isError: result.isError === true, text, payload: parsePayload(text) };
    },
  };
}
