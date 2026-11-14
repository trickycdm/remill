/**
 * The MCP tool surface — surface (6) of the schema engine
 * (steering/API_AND_MCP_STANDARDS.md). The tool list is FIXED (D65): one set of
 * document tools that each take a `collection`, the way REST has one set of
 * routes under `/api/c/:collection`. What a collection definition generates is
 * everything behind them — validation, the `data` JSON Schema that
 * `describe_collection` returns, the filters, the renders — and which tools
 * apply to it. The set is INTERSECTED with the connecting principal's effective
 * permissions: an agent that cannot `publish` anywhere never sees
 * `publish_document`, and one that can publish only in `posts` is refused it on
 * any other collection. Capability discovery IS permission discovery.
 *
 * This module is SDK-agnostic and unit-testable: it returns plain tool descriptors
 * with async handlers that call the same services as admin/REST — one pipeline,
 * three doors. The thin JSON-RPC transport (src/mcp/handler.ts) dispatches them
 * (D18 — a direct streamable-HTTP endpoint, not an `agents`-SDK Durable Object).
 */

import type { Database } from '@/db/client';
import { ACTIONS, scopeMatches, type Principal, type Action } from '@/access';
// COR-6: the MCP surface must go through SERVICES, never the queries layer directly.
import {
  getPrincipalPermissions,
  grantItem,
  listTeams,
  listAuditPage,
  describeSelf,
} from '@/services/access';
import { BadRequestError, ForbiddenError, InputValidationError, type AppError } from '@/lib/errors';
import { mintApiShareLink } from '@/services/sharing';
import { publishPage, isPageMode } from '@/services/pages';
import { PAGES_COLLECTION } from '@/config/constants';
import { listCollections, getCollection } from '@/services/collections';
import { listTemplates } from '@/templates/registry';
import { rendersFor } from '@/templates/renders';
import * as docs from '@/services/documents';
import * as comments from '@/services/comments';
import * as collectionsService from '@/services/collections';
import { listMedia, getMediaById, uploadMedia } from '@/services/media';
import { pollEvents } from '@/services/events';
import { searchSite } from '@/services/search';
import { snippetToText } from '@/lib/fts';
import { decodeBase64 } from '@/lib/base64';
import { parseSort, clampPage, clampPageSize } from '@/lib/list-query';
import { hasLifecycle } from '@/lib/lifecycle';
import { VISIBILITIES, type Visibility } from '@/lib/visibility';
import { jsonSchemaFor } from '@/fields/registry';
import type { CollectionDefinition, JSONSchema } from '@/fields/types';

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Sentinel a handler returns when its result IS text (a D47 markdown render):
 *  the transport emits `text` verbatim instead of JSON-stringifying — quoting
 *  markdown would escape every newline and bloat the exact tokens a render
 *  budget exists to save. Kept deliberately narrow: one shape, one guard, one
 *  branch in handler.ts. */
export interface McpTextResult {
  readonly kind: 'mcp-text';
  readonly text: string;
}

export function mcpText(text: string): McpTextResult {
  return { kind: 'mcp-text', text };
}

export function isMcpTextResult(value: unknown): value is McpTextResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as McpTextResult).kind === 'mcp-text' &&
    typeof (value as McpTextResult).text === 'string'
  );
}

/** Request-scoped capabilities tools need beyond the DB (threaded from the /mcp
 *  route — this module has no Context). `media` is the R2 bucket for
 *  `upload_media` (absent in tests without R2 → the tool is not offered);
 *  `consumeUploadLimit` shares REST's 'upload' rate bucket, keyed to the caller
 *  (tokenId, else client IP) — D34. */
export interface McpToolContext {
  readonly media?: R2Bucket;
  readonly consumeUploadLimit?: () => Promise<unknown>;
  /** SESSION_SECRET — keys the AES-GCM encryption of minted share-link tokens
   *  (D53), so `create_share_link` can store a re-copyable `token_enc` like
   *  the admin Share panel does. */
  readonly secret?: string;
}

/** Whether `principal` could ever perform `action` on `collection` — for tool
 *  VISIBILITY. The handler re-authorizes per call (with conditions), so showing a
 *  conditionally-available tool is fine. Honors the token scope mask. Exported
 *  for the prompts primitive (src/mcp/prompts.ts), which gates discovery with
 *  the same intersection. */
export function couldDo(
  perms: { collection: string; action: Action; condition: unknown }[],
  principal: Principal,
  action: Action,
  collection: string,
  publicRead: boolean,
): boolean {
  const scope = principal.tokenScope;
  if (scope && !scopeMatches(scope, action, collection)) return false;
  if (action === 'read' && publicRead) return true;
  return perms.some(
    (p) => p.action === action && (p.collection === '*' || p.collection === collection),
  );
}

/** An optional array-of-strings argument (absent → []); anything else is a
 *  validation error rather than a silently ignored value. */
function stringList(value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new InputValidationError([{ path, message: `${path} must be an array of strings.` }]);
  }
  return value;
}

function docInputSchema(def: CollectionDefinition): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const f of def.fields) {
    properties[f.key] = jsonSchemaFor(f);
    if (f.required) required.push(f.key);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** Convert the MCP `filters` array arg into the service's filter record (D28).
 *  Entries for one field merge (a gte + lte pair is a range); the SERVICE
 *  validates ops and field indexability — this only shapes the input. */
function filtersFromArgs(raw: unknown): Record<string, Partial<Record<docs.FilterOp, string>>> {
  const filters: Record<string, Partial<Record<docs.FilterOp, string>>> = {};
  if (!Array.isArray(raw)) return filters;
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const field = typeof e.field === 'string' ? e.field : '';
    if (!field) continue;
    const op = (typeof e.op === 'string' ? e.op : 'eq') as docs.FilterOp;
    filters[field] = { ...filters[field], [op]: String(e.value ?? '') };
  }
  return filters;
}

/** The document tools (D65), keyed by the per-collection verb each replaced:
 *  before D65 a collection `posts` generated `list_posts`, `create_posts`, …
 *  One map is both the closed list of document tool names and the source of the
 *  retired-name redirect below. */
const DOCUMENT_TOOL_BY_RETIRED_VERB = {
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
} as const;

type RetiredVerb = keyof typeof DOCUMENT_TOOL_BY_RETIRED_VERB;
export type DocumentToolName = (typeof DOCUMENT_TOOL_BY_RETIRED_VERB)[RetiredVerb];

export const DOCUMENT_TOOL_NAMES: readonly DocumentToolName[] = Object.values(
  DOCUMENT_TOOL_BY_RETIRED_VERB,
);

/** Every tool that is NOT a document tool. With `DOCUMENT_TOOL_NAMES` this is
 *  the whole surface — a test holds the two to what `tools/list` returns. */
export const STATIC_TOOL_NAMES = [
  'list_collections',
  'describe_collection',
  'whoami',
  'list_templates',
  'list_packs',
  'create_collection',
  'install_pack',
  'update_collection',
  'list_teams',
  'list_audit',
  'publish_page',
  'upload_media',
  'list_media',
  'get_media_url',
  'poll_events',
] as const;

const CURRENT_TOOL_NAMES: ReadonlySet<string> = new Set([...STATIC_TOOL_NAMES, ...DOCUMENT_TOOL_NAMES]);

/** What to tell a caller that used a pre-D65 per-collection name
 *  (`create_articles`): the tool that replaced it and the `collection` to pass.
 *  PURELY TEXTUAL — a slug cannot contain `_`, so the name splits at its last
 *  underscore; no collection is looked up, so the answer is the same whether
 *  that collection exists, is hidden, or never did (no D46 oracle). Null for
 *  anything that is not shaped like a retired name. */
export function retiredToolRedirect(name: string): { replacedBy: DocumentToolName; message: string } | null {
  if (CURRENT_TOOL_NAMES.has(name)) return null;
  const cut = name.lastIndexOf('_');
  const verb = name.slice(0, cut);
  const slug = name.slice(cut + 1);
  if (cut < 1 || !Object.hasOwn(DOCUMENT_TOOL_BY_RETIRED_VERB, verb) || !/^[a-z][a-z0-9-]*$/.test(slug)) {
    return null;
  }
  const replacedBy = DOCUMENT_TOOL_BY_RETIRED_VERB[verb as RetiredVerb];
  const fields =
    verb === 'create' || verb === 'update' ? ' Document fields now go inside a `data` object.' : '';
  return {
    replacedBy,
    message: `'${name}' was replaced by '${replacedBy}': call it with collection: "${slug}".${fields}`,
  };
}

/** A tool error whose result payload carries extra, tool-supplied keys beside
 *  the service error's own (D65): `available` when a document tool cannot act
 *  on the named collection, `hint` on a validation failure. The transport
 *  (handler.ts) renders `inner` as it would any error, then merges `extra`. */
export class McpToolError extends Error {
  constructor(
    readonly inner: AppError,
    readonly extra: Readonly<Record<string, unknown>>,
  ) {
    super(inner.message);
    this.name = 'McpToolError';
  }
}

/** One document tool: a fixed name and schema, plus the condition under which
 *  it applies to a given collection. That ONE condition decides both whether
 *  the tool is listed (it applies to at least one collection) and whether a
 *  call naming a collection is let through to the service — so what is
 *  advertised and what is reachable cannot drift. */
interface DocumentToolSpec {
  readonly name: DocumentToolName;
  readonly description: string;
  /** Arguments besides `collection`, which every document tool takes. */
  readonly properties: Record<string, JSONSchema>;
  readonly required?: readonly string[];
  /** The action a permission denial names (`missing.action`). */
  readonly action: Action;
  /** Whether the principal could ever do this in `def` (roles ∩ token scope). */
  readonly permitted: (def: CollectionDefinition) => boolean;
  /** A collection feature the tool needs beyond permission, if any. */
  readonly needs?: { readonly label: string; readonly test: (def: CollectionDefinition) => boolean };
  readonly run: (def: CollectionDefinition, args: Record<string, unknown>) => Promise<unknown>;
}

const COLLECTION_ARG: JSONSchema = {
  type: 'string',
  description: 'Collection slug — list_collections shows the ones you can use.',
};

const ID_ARG: JSONSchema = { type: 'string', description: 'the document id' };

/** The `data` argument of create/update: the document's field values. */
function dataArg(args: Record<string, unknown>): Record<string, unknown> {
  const data = args.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new InputValidationError([
      { path: 'data', message: 'data must be an object of field values — see describe_collection.' },
    ]);
  }
  return data as Record<string, unknown>;
}

/** Build the permission-filtered tool set for a principal. `baseUrl` is the
 *  absolute origin for tools that mint URLs (threaded from the route — this
 *  module has no request Context). */
export async function buildToolsForPrincipal(
  db: Database,
  principal: Principal,
  now: () => string,
  baseUrl = '',
  ctx: McpToolContext = {},
): Promise<McpTool[]> {
  const perms = await getPrincipalPermissions(db, principal.id);
  const collections = await listCollections(db);
  // Discovery derives from the permissions and definitions already in hand (TD-3).
  const discoverable = collectionsService.discoverableFrom(collections, perms, principal);
  const tools: McpTool[] = [];

  // Ungated: the caller's own identity and permissions — how an agent learns
  // why a call was refused (and which grant or role would fix it).
  tools.push({
    name: 'whoami',
    description:
      'Your identity on this server: principal, role assignments, the permissions they resolve to ' +
      '(collection, action, condition — `own` means documents you created), the token scope mask, and ' +
      'the OAuth client you connected through. Check this when a call is refused FORBIDDEN.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => describeSelf(db, principal),
  });
  // Template + pack discovery — ungated like list_collections: registry
  // metadata is code, and `installed` reveals nothing list_collections doesn't.
  tools.push({
    name: 'list_templates',
    description:
      'List the reading TEMPLATES a collection can select via its `template` key — each renders a ' +
      'designed public page for documents in that collection. Templates bind fields by convention; ' +
      'a collection can pin slots explicitly via its `bind` key ({title|hero|lead: field key}).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listTemplates(),
  });
  tools.push({
    name: 'list_packs',
    description:
      'List the installable content PACKS — a pack bundles a reading template with the collection ' +
      'definition(s) co-designed for it (e.g. the blog pack: an articles collection + the article ' +
      'template). Shows what each install would create and whether it already exists. Install with ' +
      'install_pack.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => collectionsService.listPackStatuses(db, principal),
  });
  if (couldDo(perms, principal, 'manage_schema', '*', false)) {
    // A new collection needs no new tools (D65): the document tools take its
    // slug at once, in the same session — so the result says exactly that.
    const usableNow = (slugs: readonly string[]) =>
      `Ready to use: pass collection: ${slugs.map((x) => `"${x}"`).join(' or ')} to create_document, ` +
      'list_documents and the other document tools — no reconnect needed.';
    const definitionSchema = collectionsService.collectionDefinitionJsonSchema();
    tools.push({
      name: 'create_collection',
      description:
        'Define a new content type — a collection to group documents — then fill it straight away by ' +
        'passing its slug as `collection` to create_document. `definition` is {slug, name, shape, ' +
        'fields[]}; its schema documents every field type and its `config`: text, slug, markdown, html, ' +
        'number, boolean, datetime, select, tags, json, media, relation. For a ready-made shape (blog, docs, ' +
        'prompts, …) prefer install_pack. Omit `access` for an ordinary internal collection; ' +
        '{publicRead: true} publishes documents to anyone, {private: true} hides the collection from ' +
        'principals without read access.',
      inputSchema: {
        type: 'object',
        properties: { definition: definitionSchema },
        required: ['definition'],
      },
      handler: async (args) => {
        const def = await collectionsService.createCollection(
          db,
          principal,
          args.definition as CollectionDefinition,
          now(),
        );
        return { ...def, note: usableNow([def.slug]) };
      },
    });
    tools.push({
      name: 'install_pack',
      description:
        'Install a content pack (see list_packs): creates its co-designed collection(s) through the ' +
        'standard validated pipeline, ready to fill immediately — no field design needed. Optional ' +
        '`slug` renames the collection (single-collection packs only). Fails with a conflict if a ' +
        'target collection already exists.',
      inputSchema: {
        type: 'object',
        properties: { pack: { type: 'string' }, slug: { type: 'string' } },
        required: ['pack'],
      },
      handler: async (args) => {
        const installed = await collectionsService.installPack(
          db,
          principal,
          String(args.pack),
          now(),
          args.slug !== undefined ? { slug: String(args.slug) } : undefined,
        );
        return { collections: installed, note: usableNow(installed.map((d) => d.slug)) };
      },
    });
    tools.push({
      name: 'update_collection',
      description:
        'Modify an existing content type. The definition REPLACES the stored one (send every field you ' +
        'want to keep — read it first with describe_collection) and follows the create_collection schema. ' +
        'Turning publicRead ON over existing documents requires `onEnablePublic` (D57): ' +
        "'private' switches them all to private first (recommended), 'keep' publishes them as they are.",
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          definition: definitionSchema,
          onEnablePublic: { type: 'string', enum: [...collectionsService.ON_ENABLE_PUBLIC] },
        },
        required: ['slug', 'definition'],
      },
      handler: async (args) =>
        collectionsService.updateCollection(
          db,
          principal,
          String(args.slug),
          args.definition as CollectionDefinition,
          now(),
          { onEnablePublic: collectionsService.parseOnEnablePublic(args.onEnablePublic) },
        ),
    });
  }

  // Team discovery — resolve "the tech team" to a team id for share_document.
  // Visible with manage_access (the same capability the share tools need).
  if (couldDo(perms, principal, 'manage_access', '*', false)) {
    tools.push({
      name: 'list_teams',
      description: 'List the teams (named groups of people) that documents can be shared with.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => listTeams(db),
    });
    tools.push({
      name: 'list_audit',
      description:
        'Query the audit trail — every authorization decision (allow AND deny) across admin/REST/MCP, attributed to principal + token. Filter by principal_id / action / collection / result / surface; page with the returned nextCursor.',
      inputSchema: {
        type: 'object',
        properties: {
          principal_id: { type: 'string' },
          action: { type: 'string' },
          collection: { type: 'string' },
          result: { type: 'string', enum: ['allow', 'deny'] },
          surface: { type: 'string', enum: ['admin', 'rest', 'mcp'] },
          cursor: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      handler: async (args) =>
        listAuditPage(
          db,
          principal,
          {
            filters: {
              principalId: typeof args.principal_id === 'string' ? args.principal_id : undefined,
              action: typeof args.action === 'string' ? args.action : undefined,
              collection: typeof args.collection === 'string' ? args.collection : undefined,
              allowed: args.result === 'allow' ? true : args.result === 'deny' ? false : undefined,
              surface: typeof args.surface === 'string' ? args.surface : undefined,
            },
            cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
            limit: typeof args.limit === 'number' ? args.limit : undefined,
          },
          now(),
        ),
    });
  }

  // Pages (D62): publish a standalone HTML page in ONE call — the built-in
  // `pages` collection in the viewer (inline D63, or framed D60). Static sugar over create/update +
  // share_link for that collection (services/pages).
  const pagesDef = collections.find(
    (d) => d.slug === PAGES_COLLECTION && isPageMode(d.renderMode) && d.fields.some((f) => f.type === 'html'),
  );
  if (
    pagesDef &&
    (couldDo(perms, principal, 'create', pagesDef.slug, false) || couldDo(perms, principal, 'update', pagesDef.slug, false))
  ) {
    tools.push({
      name: 'publish_page',
      description:
        'Publish a standalone HTML page and get its URL — the way to share a report, chart, dashboard or any ' +
        'self-contained document. Pass the COMPLETE HTML document (doctype, head, body, your own CSS and JS inline). ' +
        (pagesDef.renderMode === 'inline'
          ? 'It renders inside a viewer with sharing, comments and version history. ' +
            "Your <style> applies only to your page (body/html/:root rules target the page). Inline scripts run; " +
            'scripts/styles may also load from cdnjs.cloudflare.com, cdn.jsdelivr.net and unpkg.com (and ' +
            '/vendor/chart.umd.js on this site); Google Fonts and https images load; network calls to other sites ' +
            'do NOT work — embed the data in the page. '
          : 'It renders in a sandboxed frame inside a viewer with sharing, comments and version history. ' +
            'In the frame: inline scripts and styles run; scripts/styles may also load from cdnjs.cloudflare.com, ' +
            'cdn.jsdelivr.net and unpkg.com (and /vendor/chart.umd.js on this site); Google Fonts and https images load; ' +
            'network calls (fetch/XHR) and localStorage/cookies do NOT work — embed the data in the page. ') +
        'Pages are private: `url` opens for signed-in people who can read it. To hand it to anyone else, pass `share` ' +
        'for a link in the same call (add `share.review` to let them comment). ' +
        'To revise a page, call again with its `id` — the URL and links stay the same and the old version is kept. ' +
        'The result lists `warnings` for anything in the page that will not work.',
      inputSchema: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'the complete HTML document' },
          title: {
            type: 'string',
            description: "shown in the viewer and lists; defaults to the page's <title>, then its first <h1>",
          },
          description: { type: 'string', description: 'one or two sentences on what the page is' },
          tags: { type: 'array', items: { type: 'string' }, description: 'labels for finding it later' },
          id: { type: 'string', description: 'an existing page id — update that page instead of creating one' },
          expectedRevision: {
            type: 'integer',
            description: 'with `id`: the revision you based this on; the save is refused (STALE_REVISION) if it moved on',
          },
          share: {
            type: 'object',
            description: 'also mint an anonymous link to the page',
            properties: {
              expiresAt: { type: 'string', description: 'REQUIRED ISO-8601 expiry (clamped to 30 days out)' },
              password: { type: 'string', description: 'optional password (min 8 characters)' },
              label: { type: 'string', description: 'optional human label shown in the Share panel' },
              review: {
                type: 'object',
                description: 'make it a REVIEW link: whoever opens it can also comment',
                properties: {
                  mode: { type: 'string', enum: ['group', 'individual'] },
                  reviewer: { type: 'string', description: 'name the one person this link is for' },
                },
              },
            },
            required: ['expiresAt'],
          },
        },
        required: ['html'],
      },
      handler: async (args) => publishPage(db, principal, args, { secret: ctx.secret ?? '', baseUrl }, now()),
    });
  }

  // ---------------------------------------------------------------------------
  // Document tools (D65): ONE fixed set, each taking `collection`. Before D65
  // these were generated per collection (`create_<slug>` …), which grew the tool
  // list by up to 19 per collection. Each spec's condition is the one the old
  // generator used to decide whether to EMIT the per-collection tool, unchanged.
  // ---------------------------------------------------------------------------
  const can = (action: Action, def: CollectionDefinition) =>
    couldDo(perms, principal, action, def.slug, def.access?.publicRead === true);
  // Review threads (D55): reading and resolving admit `comment` OR `update`
  // (whoever may edit the text may see the feedback on it); posting and
  // replying need `comment` — mirrors the comments service's gates.
  const canSeeReview = (def: CollectionDefinition) => can('comment', def) || can('update', def);
  const annotatable = { label: 'an html or markdown field', test: comments.hasAnnotatableFields };
  const lifecycle = { label: 'a draft/published lifecycle', test: hasLifecycle };
  const publicPages = {
    label: 'public pages (access.publicRead)',
    test: (def: CollectionDefinition) => def.access?.publicRead === true,
  };
  /** Validation failures on a write name the wrong key but not the right ones;
   *  add them. Reached only past the tool's own permission check, so only by
   *  callers `describe_collection` would show the full schema to anyway. */
  const withFieldHint = async <T>(def: CollectionDefinition, save: () => Promise<T>): Promise<T> => {
    try {
      return await save();
    } catch (err) {
      if (!(err instanceof InputValidationError)) throw err;
      const fields = def.fields.map((f) => (f.required ? `${f.key} (required)` : f.key)).join(', ');
      throw new McpToolError(err, {
        hint: `Fields of '${def.slug}': ${fields}. describe_collection returns their full schema.`,
      });
    }
  };

  const specs: DocumentToolSpec[] = [
    {
      name: 'list_documents',
      description:
        'List the documents in a collection (filter/sort/paginate). Filter and sort only on indexed ' +
        'fields — describe_collection lists them.',
      properties: {
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        status: {
          type: 'string',
          enum: ['draft', 'published'],
          description: 'only for collections with a draft/published lifecycle',
        },
        sort: { type: 'string', description: 'indexed field name, prefix "-" for descending' },
        filters: {
          type: 'array',
          description:
            'filters on indexed fields; op defaults to eq (gte/lte compare, contains substring-matches text, in matches any of comma-separated values)',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: [...docs.FILTER_OPS] },
              value: { type: 'string' },
            },
            required: ['field', 'value'],
          },
        },
      },
      action: 'read',
      permitted: (def) => can('read', def),
      run: async (def, args) =>
        docs.listDocuments(
          db,
          principal,
          def.slug,
          {
            page: clampPage(args.page),
            pageSize: clampPageSize(args.pageSize),
            status: args.status as 'draft' | 'published' | undefined,
            sort: parseSort(typeof args.sort === 'string' ? args.sort : undefined),
            filters: filtersFromArgs(args.filters),
          },
          now(),
        ),
    },
    {
      name: 'search_documents',
      description:
        'Full-text search the documents in a collection — matches title and body text, relevance-ranked (D28).',
      properties: {
        q: {
          type: 'string',
          description: 'search terms (words are ANDed; the last word prefix-matches)',
        },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      required: ['q'],
      action: 'read',
      permitted: (def) => can('read', def),
      run: async (def, args) => {
        const res = await searchSite(
          db,
          principal,
          {
            q: String(args.q ?? ''),
            collection: def.slug,
            limit: typeof args.limit === 'number' ? args.limit : undefined,
            offset: typeof args.offset === 'number' ? args.offset : undefined,
          },
          now(),
        );
        return {
          hits: res.hits.map((h) => ({ ...h, snippet: snippetToText(h.snippet) })),
          hasMore: res.hasMore,
        };
      },
    },
    {
      name: 'get_document',
      description:
        'Get one document by id. Its `revision` is what update_document expects back. Pass `render` for a ' +
        'role-tailored markdown brief instead of raw JSON — describe_collection lists the renders a ' +
        'collection offers (D47; `review` is the open review threads, D55); `budget` caps its approximate tokens.',
      properties: {
        id: ID_ARG,
        render: { type: 'string', description: 'Named text render — returns markdown, not JSON.' },
        budget: { type: 'integer', description: 'Approximate token cap for the render.' },
      },
      required: ['id'],
      action: 'read',
      permitted: (def) => can('read', def),
      run: async (def, args) => {
        const id = String(args.id);
        const budget = typeof args.budget === 'number' ? args.budget : undefined;
        // `review` (D55) is offered on any collection with annotatable fields,
        // to principals who may see its review threads — the brief IS the threads.
        if (args.render === 'review' && annotatable.test(def) && canSeeReview(def)) {
          return mcpText(await comments.renderReview(db, principal, def.slug, id, { budget }, now()));
        }
        if (typeof args.render === 'string') {
          return mcpText(
            await docs.renderDocumentText(
              db,
              principal,
              def.slug,
              id,
              { render: args.render, budget, baseUrl },
              now(),
            ),
          );
        }
        return docs.getDocument(db, principal, def.slug, id, now());
      },
    },
    {
      name: 'get_backlinks',
      description:
        'List the documents that reference a document via relation fields (reverse links — the graph).',
      properties: { id: ID_ARG },
      required: ['id'],
      action: 'read',
      permitted: (def) => can('read', def),
      run: async (def, args) => docs.getBacklinks(db, principal, def.slug, String(args.id), now()),
    },
    {
      name: 'list_revisions',
      description: 'Revision history for a document (newest first — every save appends one).',
      properties: { id: ID_ARG },
      required: ['id'],
      action: 'read',
      permitted: (def) => can('read', def),
      run: async (def, args) => docs.listRevisions(db, principal, def.slug, String(args.id), now()),
    },
    {
      name: 'create_document',
      description:
        'Create a document in a collection. `data` holds its field values — describe_collection returns ' +
        "the collection's fields as a JSON Schema (required fields, select options, relation targets). " +
        'Undeclared fields are rejected.',
      properties: { data: { type: 'object', description: 'field values, keyed by field key' } },
      required: ['data'],
      action: 'create',
      permitted: (def) => can('create', def),
      run: async (def, args) => {
        const data = dataArg(args);
        return withFieldHint(def, () => docs.createDocument(db, principal, def.slug, data, now()));
      },
    },
    {
      name: 'update_document',
      description:
        'Update a document. `data` holds only the fields that change. Pass expectedRevision — the ' +
        '`revision` from get_document your edit is based on — so a save made on a stale copy fails with ' +
        'STALE_REVISION instead of overwriting newer work (re-read, re-apply, retry).',
      properties: {
        id: ID_ARG,
        expectedRevision: {
          type: 'integer',
          description: 'The revision your edit is based on (from get_document).',
        },
        data: { type: 'object', description: 'changed field values, keyed by field key' },
        resolves: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Review thread ids (threadId from get_document render=review) this save addresses — resolved at the new revision once it saves.',
        },
      },
      required: ['id', 'data'],
      action: 'update',
      permitted: (def) => can('update', def),
      run: async (def, args) => {
        const id = String(args.id);
        const data = dataArg(args);
        const threadIds = stringList(args.resolves, 'resolves');
        // Check the threads BEFORE saving, so a bad id can't leave a saved
        // document with the threads it claimed to address still open.
        if (threadIds.length) {
          await comments.assertResolvable(db, principal, def.slug, id, threadIds, now());
        }
        const doc = await withFieldHint(def, () =>
          docs.updateDocument(db, principal, def.slug, id, data, now(), {
            expectedRevision: docs.parseExpectedRevision(args.expectedRevision),
          }),
        );
        if (threadIds.length) {
          await comments.resolveThreads(db, principal, def.slug, id, threadIds, now());
        }
        return threadIds.length ? { ...doc, resolvedThreads: threadIds } : doc;
      },
    },
    {
      name: 'restore_revision',
      description:
        'Restore a prior revision of a document as a new save (history is preserved — see list_revisions).',
      properties: { id: ID_ARG, revision: { type: 'integer' } },
      required: ['id', 'revision'],
      action: 'update',
      permitted: (def) => can('update', def),
      run: async (def, args) =>
        docs.restoreRevision(db, principal, def.slug, String(args.id), Number(args.revision), now()),
    },
    {
      name: 'delete_document',
      description:
        'Delete a document. Moves to trash — recoverable by an admin for 30 days, then purged.',
      properties: { id: ID_ARG },
      required: ['id'],
      action: 'delete',
      permitted: (def) => can('delete', def),
      run: async (def, args) => {
        await docs.deleteDocument(db, principal, def.slug, String(args.id), now());
        return { deleted: true, recoverableDays: 30 };
      },
    },
    {
      name: 'publish_document',
      description: 'Publish a document, or unpublish it with publish=false.',
      properties: { id: ID_ARG, publish: { type: 'boolean' } },
      required: ['id'],
      action: 'publish',
      permitted: (def) => can('publish', def),
      needs: lifecycle,
      run: async (def, args) =>
        docs.setPublished(db, principal, def.slug, String(args.id), args.publish !== false, now()),
    },
    {
      name: 'schedule_document',
      description:
        'Schedule a draft document to publish at a future time (D32), or cancel a pending schedule. Provide exactly one of publish_at / cancel.',
      properties: {
        id: ID_ARG,
        publish_at: {
          type: 'string',
          description: 'ISO-8601 datetime to publish at (drafts only)',
        },
        cancel: { type: 'boolean', description: 'true to clear a pending schedule' },
      },
      required: ['id'],
      action: 'publish',
      permitted: (def) => can('publish', def),
      needs: lifecycle,
      run: async (def, args) => {
        const hasAt = typeof args.publish_at === 'string' && args.publish_at !== '';
        const cancel = args.cancel === true;
        if (hasAt === cancel) {
          throw new InputValidationError([
            { path: 'publish_at', message: 'Provide exactly one of publish_at or cancel:true.' },
          ]);
        }
        return docs.scheduleDocument(
          db,
          principal,
          def.slug,
          String(args.id),
          cancel ? null : String(args.publish_at),
          now(),
        );
      },
    },
    {
      // Visibility (D50) only matters for collections readable by the public —
      // gated on publicRead (like the editor sidebar control), not lifecycle: a
      // lifecycle:'none' document is always 'published', so visibility alone
      // still decides whether the public list/read surfaces show it.
      name: 'set_visibility',
      description:
        "Set a document's visibility (D50): public (listed everywhere), unlisted (reachable only by its doc_ id link, not listed), or private (no public URL at all — share it via create_share_link). Allowed on drafts too; it takes effect once published.",
      properties: { id: ID_ARG, visibility: { type: 'string', enum: [...VISIBILITIES] } },
      required: ['id', 'visibility'],
      action: 'publish',
      permitted: (def) => can('publish', def),
      needs: publicPages,
      run: async (def, args) =>
        docs.setVisibility(db, principal, def.slug, String(args.id), args.visibility as Visibility, now()),
    },
    {
      name: 'share_document',
      description:
        'Grant a principal, role, or team scoped actions on one document (item grant, optionally expiring).',
      properties: {
        id: { type: 'string', description: 'the document id to share' },
        subjectKind: { type: 'string', enum: ['principal', 'role', 'team'] },
        subjectId: { type: 'string', description: 'principal id, role slug, or team id' },
        actions: {
          type: 'array',
          items: { type: 'string' },
          description: 'actions to grant, e.g. ["read"]',
        },
        expiresAt: { type: 'string', description: 'optional ISO-8601 expiry' },
      },
      required: ['id', 'subjectKind', 'subjectId', 'actions'],
      action: 'manage_access',
      permitted: (def) => can('manage_access', def),
      run: async (def, args) => ({
        id: await grantItem(
          db,
          principal,
          {
            subjectKind:
              args.subjectKind === 'role' ? 'role' : args.subjectKind === 'team' ? 'team' : 'principal',
            subjectId: String(args.subjectId ?? ''),
            documentId: String(args.id ?? ''),
            collection: def.slug,
            actions: Array.isArray(args.actions) ? (args.actions.map(String) as Action[]) : [],
            expiresAt: typeof args.expiresAt === 'string' ? args.expiresAt : undefined,
          },
          now(),
        ),
      }),
    },
    {
      name: 'create_share_link',
      description:
        'Mint an anonymous, expiring share link for one document. Anyone with the URL can open it — no account needed. READ-ONLY by default; pass `review` for a review link whose holders can also comment. Expiry is required and clamped to 30 days.',
      properties: {
        id: { type: 'string', description: 'the document id to share' },
        expiresAt: {
          type: 'string',
          description: 'REQUIRED ISO-8601 expiry (clamped to 30 days out)',
        },
        password: {
          type: 'string',
          description: 'optional password to require before the link opens (min 8 characters)',
        },
        label: { type: 'string', description: 'optional human label shown in the Share panel' },
        review: {
          type: 'object',
          description:
            'optional — make this a REVIEW link: whoever opens it can also comment on the document (needs your `comment` permission as well as `share_link`). Omit for a read-only link.',
          properties: {
            mode: {
              type: 'string',
              enum: ['group', 'individual'],
              description:
                "'group' (default): reviewers on group links see each other's comments. 'individual': each reviewer sees only their own.",
            },
            reviewer: {
              type: 'string',
              description:
                'name the one person this link is for; omit for an open link where each reviewer types their name',
            },
          },
        },
      },
      required: ['id', 'expiresAt'],
      action: 'share_link',
      permitted: (def) => can('share_link', def),
      run: async (def, args) => {
        // Validation, the 30-day clamp and the review rules all live in
        // mintApiShareLink() — ONE implementation for this tool and REST.
        const { token, ...link } = await mintApiShareLink(
          db,
          principal,
          {
            collection: def.slug,
            documentId: String(args.id ?? ''),
            expiresAt: args.expiresAt,
            password: args.password,
            label: args.label,
            review: args.review,
          },
          ctx.secret ?? '',
          now(),
        );
        // The plaintext token intentionally enters the agent's context — that
        // IS the capability; it stays revocable from the Share panel/matrix.
        return {
          grantId: link.grantId,
          url: `${baseUrl}/s/${token}`,
          expiresAt: link.expiresAt,
          hasPassword: link.hasPassword,
          label: link.label,
          review: link.review,
        };
      },
    },
    {
      name: 'list_comments',
      description:
        'Review threads on a document as JSON — roots with replies, each with its author, time, body, intent, anchor and status. For a readable brief use get_document with render=review.',
      properties: {
        id: ID_ARG,
        status: { type: 'string', enum: ['open', 'resolved'] },
        intent: { type: 'string', enum: [...comments.COMMENT_INTENTS] },
      },
      required: ['id'],
      action: 'comment',
      permitted: canSeeReview,
      needs: annotatable,
      run: async (def, args) =>
        comments.listThreads(
          db,
          { kind: 'principal', principal },
          def.slug,
          String(args.id),
          {
            status: args.status === 'open' || args.status === 'resolved' ? args.status : undefined,
            intent: (comments.COMMENT_INTENTS as readonly unknown[]).includes(args.intent)
              ? (args.intent as comments.CommentIntent)
              : undefined,
          },
          now(),
        ),
    },
    {
      name: 'add_comment',
      description:
        'Start a review thread on a document. Pass `quote` (exact text from the document) to comment on a passage, ' +
        '`blockId` to comment on a figure/widget, or neither for a general note. `visibility`: internal (default — ' +
        'principals only) or shared (review-link reviewers see it too).',
      properties: {
        id: ID_ARG,
        body: { type: 'string' },
        quote: { type: 'string' },
        field: { type: 'string', description: 'Field the quote is in (optional — found automatically).' },
        blockId: { type: 'string' },
        intent: { type: 'string', enum: [...comments.COMMENT_INTENTS] },
        visibility: { type: 'string', enum: ['internal', 'shared'] },
      },
      required: ['id', 'body'],
      action: 'comment',
      permitted: (def) => can('comment', def),
      needs: annotatable,
      run: async (def, args) => {
        const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
        const quote = str(args.quote);
        const blockId = str(args.blockId);
        const anchor: comments.AnchorInput = quote
          ? { kind: 'text', quote, field: str(args.field), blockId }
          : blockId
            ? { kind: 'block', blockId, field: str(args.field) }
            : { kind: 'document' };
        return comments.createThread(
          db,
          { kind: 'principal', principal },
          def.slug,
          String(args.id),
          { anchor, body: String(args.body ?? ''), intent: str(args.intent), visibility: str(args.visibility) },
          now(),
        );
      },
    },
    {
      name: 'reply_comment',
      description: 'Reply to a review thread on a document.',
      properties: { id: ID_ARG, threadId: { type: 'string' }, body: { type: 'string' } },
      required: ['id', 'threadId', 'body'],
      action: 'comment',
      permitted: (def) => can('comment', def),
      needs: annotatable,
      run: async (def, args) =>
        comments.replyToThread(
          db,
          { kind: 'principal', principal },
          def.slug,
          String(args.id),
          String(args.threadId),
          { body: String(args.body ?? '') },
          now(),
        ),
    },
    {
      name: 'resolve_comment',
      description:
        "Resolve a review thread on a document (stamped with the current revision), or reopen it with reopen=true. Prefer update_document's `resolves` when a save addresses the thread.",
      properties: { id: ID_ARG, threadId: { type: 'string' }, reopen: { type: 'boolean' } },
      required: ['id', 'threadId'],
      action: 'comment',
      permitted: canSeeReview,
      needs: annotatable,
      run: async (def, args) =>
        comments.setThreadResolved(
          db,
          principal,
          def.slug,
          String(args.id),
          String(args.threadId),
          args.reopen !== true,
          now(),
        ),
    },
  ];

  // `media` is a collection but never a document-tool target: it has its own
  // tools below (uploads go through MIME sniffing and R2, not createDocument).
  const documentCollections = collections.filter((d) => d.slug !== 'media');
  const appliesTo = (spec: DocumentToolSpec, def: CollectionDefinition) =>
    spec.permitted(def) && (spec.needs?.test(def) ?? true);
  const toolsOn = (def: CollectionDefinition) =>
    documentCollections.includes(def) ? specs.filter((s) => appliesTo(s, def)).map((s) => s.name) : [];
  /** Whether the caller may know `def` exists at all: it is in discovery, or a
   *  tool applies to it (a create-only token on a private collection). */
  const isKnown = (def: CollectionDefinition) =>
    discoverable.defs.includes(def) || toolsOn(def).length > 0;
  const unavailable = (slug: string, available: string[]) =>
    // Hidden and nonexistent are ONE answer (D46) — and it must come from here:
    // several write services look the collection up before they authorize.
    new McpToolError(new ForbiddenError(`Unknown or unavailable collection '${slug}'.`), { available });

  /** The per-call half of a spec's condition. Refusals here never reach the
   *  service, so they are not audited — like the unknown-tool refusal. */
  const resolveCollection = (spec: DocumentToolSpec, raw: unknown): CollectionDefinition => {
    const slug = typeof raw === 'string' ? raw : '';
    const def = documentCollections.find((d) => d.slug === slug);
    if (def && appliesTo(spec, def)) return def;
    const available = documentCollections.filter((d) => appliesTo(spec, d)).map((d) => d.slug);
    if (!def || !isKnown(def)) throw unavailable(slug, available);
    if (!spec.permitted(def)) {
      throw new McpToolError(
        new ForbiddenError(`Not permitted to ${spec.action} in '${slug}'`, {
          action: spec.action,
          collection: slug,
        }),
        { available },
      );
    }
    throw new McpToolError(
      new BadRequestError(`${spec.name} does not apply to '${slug}': it has no ${spec.needs?.label}.`),
      { available },
    );
  };

  for (const spec of specs) {
    if (!documentCollections.some((d) => appliesTo(spec, d))) continue;
    tools.push({
      name: spec.name,
      description: spec.description,
      inputSchema: {
        type: 'object',
        properties: { collection: COLLECTION_ARG, ...spec.properties },
        required: ['collection', ...(spec.required ?? [])],
      },
      handler: async (args) => spec.run(resolveCollection(spec, args.collection), args),
    });
  }

  // Collection discovery. `list_collections` is the map an agent starts from;
  // `describe_collection` is what the per-collection tool schemas used to carry.
  const actionsOn = (def: CollectionDefinition) => ACTIONS.filter((a) => can(a, def));
  const view = (def: CollectionDefinition) =>
    discoverable.internals ? def : collectionsService.toPublicView(def);
  tools.unshift(
    {
      name: 'list_collections',
      description:
        'List the collections (content types) on this server: slug, name, fields, and `actions` — what you ' +
        'may do in each. Pass a slug as `collection` to the document tools; describe_collection returns ' +
        "one collection's full detail.",
      inputSchema: { type: 'object', properties: {} },
      // SEC-5: discovery is public but projected — and compact for everyone here:
      // this is the first call of every session, so definitions stay in describe.
      handler: async () =>
        discoverable.defs.map((d) => ({ ...collectionsService.toPublicView(d), actions: actionsOn(d) })),
    },
    {
      name: 'describe_collection',
      description:
        'Everything needed to work with one collection: its fields, the document tools that apply to it for ' +
        'you (`tools`), and — where you may write — `dataSchema`, the JSON Schema of the `data` argument of ' +
        'create_document / update_document. Also the indexed fields you can filter and sort on, and the ' +
        'text `renders` get_document offers.',
      inputSchema: {
        type: 'object',
        properties: { collection: COLLECTION_ARG },
        required: ['collection'],
      },
      handler: async (args) => {
        const slug = typeof args.collection === 'string' ? args.collection : '';
        const def = collections.find((d) => d.slug === slug);
        if (!def || !isKnown(def)) {
          throw unavailable(slug, collections.filter(isKnown).map((d) => d.slug));
        }
        return {
          ...view(def),
          actions: actionsOn(def),
          tools: toolsOn(def),
          lifecycle: hasLifecycle(def),
          publicRead: def.access?.publicRead === true,
          ...(can('read', def)
            ? {
                indexedFields: def.fields.filter((f) => f.index).map((f) => f.key),
                renders: [
                  ...rendersFor(def.template),
                  ...(annotatable.test(def) && canSeeReview(def) ? ['review'] : []),
                ],
              }
            : {}),
          // The same callers who saw this schema on `create_<slug>` / `update_<slug>`.
          ...(can('create', def) || can('update', def) ? { dataSchema: docInputSchema(def) } : {}),
        };
      },
    },
  );

  // Media upload (D34): base64 over JSON-RPC, riding the SAME service (MIME
  // sniff, 25 MiB cap, alt-required) and the SAME 'upload' rate bucket as REST.
  // Offered only when the route threads the R2 bucket in (ctx.media).
  if (ctx.media && couldDo(perms, principal, 'create', 'media', false)) {
    const bucket = ctx.media;
    tools.push({
      name: 'upload_media',
      description:
        'Upload a media file as base64. Effective file limit ~6 MiB (8 MiB request cap) — use REST multipart POST /api/media for larger files (25 MiB). Images REQUIRE alt text.',
      inputSchema: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          alt: { type: 'string', description: 'REQUIRED for images (accessibility)' },
          content_base64: { type: 'string', description: 'the file bytes, standard base64' },
        },
        required: ['filename', 'content_base64'],
      },
      handler: async (args) => {
        await ctx.consumeUploadLimit?.();
        const bytes = decodeBase64(String(args.content_base64 ?? ''));
        const rec = await uploadMedia(
          db,
          bucket,
          principal,
          {
            filename: String(args.filename ?? 'file'),
            bytes,
            alt: typeof args.alt === 'string' ? args.alt : undefined,
          },
          now(),
        );
        return {
          id: rec.id,
          url: `/media/${rec.id}`,
          mime: rec.mime,
          size: rec.size,
          alt: rec.alt,
        };
      },
    });
  }

  // Media read tools.
  if (
    couldDo(
      perms,
      principal,
      'read',
      'media',
      (await getCollection(db, 'media'))?.access?.publicRead === true,
    )
  ) {
    tools.push({
      name: 'list_media',
      description:
        'List uploaded media assets (newest first; pass the returned cursor for the next page).',
      inputSchema: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'opaque cursor from a previous page' },
          pageSize: { type: 'integer' },
        },
      },
      handler: async (args) =>
        listMedia(
          db,
          principal,
          {
            cursor: typeof args.cursor === 'string' ? args.cursor : null,
            limit: args.pageSize as number | undefined,
          },
          now(),
        ),
    });
    tools.push({
      name: 'get_media_url',
      description: 'Get the serving URL for a media asset by id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      // COR-6: resolve through the Grant-gated media service — never a raw query.
      // Unauthorized/unknown ids surface as a structured tool error (authorize()).
      handler: async (args) => {
        const m = await getMediaById(db, principal, String(args.id), now());
        return { id: m.id, url: `/media/${m.id}`, mime: m.mime, alt: m.alt };
      },
    });
  }

  // Events feed (D33): offered to every principal — the SERVICE filters rows
  // to collections the caller can read, so an over-scoped poll simply returns
  // less, never errors.
  tools.push({
    name: 'poll_events',
    description:
      'Poll the change feed: events (pointers — type, collection, resource id, actor, time; no payload) after `since`, for collections you can read. Re-fetch changed content with the read tools. Pass the returned nextSince back as since. Events prune after 30 days — gaps in seq are normal.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'integer', description: 'last seen event seq (default 0)' },
        collection: { type: 'string', description: 'narrow to one collection slug' },
        limit: { type: 'integer', description: 'max events (default 100, cap 500)' },
      },
    },
    handler: async (args) =>
      pollEvents(db, principal, {
        since: args.since === undefined ? undefined : Number(args.since),
        collection:
          typeof args.collection === 'string' && args.collection ? args.collection : undefined,
        limit: args.limit === undefined ? undefined : Number(args.limit),
      }),
  });

  return tools;
}
