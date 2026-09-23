/**
 * MCP tool generation — surface (6) of the schema engine
 * (steering/API_AND_MCP_STANDARDS.md). Tools are GENERATED per collection from the
 * same field descriptors as every other surface, and the set is INTERSECTED with
 * the connecting principal's effective permissions: an agent without `publish`
 * never sees `publish_<slug>`. Capability discovery IS permission discovery.
 *
 * This module is SDK-agnostic and unit-testable: it returns plain tool descriptors
 * with async handlers that call the same services as admin/REST — one pipeline,
 * three doors. The thin JSON-RPC transport (src/mcp/handler.ts) dispatches them
 * (D18 — a direct streamable-HTTP endpoint, not an `agents`-SDK Durable Object).
 */

import type { Database } from '@/db/client';
import { scopeMatches, type Principal, type Action } from '@/access';
// COR-6: the MCP surface must go through SERVICES, never the queries layer directly.
import {
  getPrincipalPermissions,
  grantItem,
  listTeams,
  createShareLink,
  listAuditPage,
} from '@/services/access';
import { InputValidationError } from '@/lib/errors';
import {
  listCollections,
  getCollection,
  listCollectionsForDiscovery,
} from '@/services/collections';
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
   *  (D53), so `share_link_<slug>` can store a re-copyable `token_enc` like
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

/** Agent-minted share links MUST expire; requested expiries are clamped to 30
 *  days (D26). Humans in the admin Share panel may still mint open-ended links. */
const SHARE_LINK_MAX_TTL_DAYS = 30;

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
  const tools: McpTool[] = [];

  // Schema management (guarded by manage_schema).
  tools.push({
    name: 'list_collections',
    description: 'List all content-type definitions.',
    inputSchema: { type: 'object', properties: {} },
    // SEC-5: discovery is public but projected — unauthenticated/unprivileged
    // callers never see the internal access/workflow config.
    handler: async () => listCollectionsForDiscovery(db, principal),
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
    tools.push({
      name: 'create_collection',
      description:
        'Define a new content type. The body is a collection definition (slug, name, shape, fields[]). ' +
        'Field keys are lowercase snake_case (^[a-z][a-z0-9_]*$). A slug field is indexed by default so it ' +
        'serves the pretty public URL; set index:true on any relation field you want backlinks or filtering on. ' +
        'Optional `template` selects a designed public reading page (see list_templates) and `bind` pins its ' +
        'title/hero/lead slots to specific fields; for a ready-made shape, prefer install_pack. ' +
        'Optional `access` sets visibility: {publicRead: true} lets anyone read published documents; ' +
        '{private: true} hides the collection from discovery (list_collections, the REST API index, ' +
        'OpenAPI) for principals without read access. The two are mutually exclusive.',
      inputSchema: {
        type: 'object',
        properties: { definition: { type: 'object' } },
        required: ['definition'],
      },
      handler: async (args) =>
        collectionsService.createCollection(
          db,
          principal,
          args.definition as CollectionDefinition,
          now(),
        ),
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
      handler: async (args) =>
        collectionsService.installPack(
          db,
          principal,
          String(args.pack),
          now(),
          args.slug !== undefined ? { slug: String(args.slug) } : undefined,
        ),
    });
    tools.push({
      name: 'update_collection',
      description:
        'Modify an existing content type. The definition replaces the stored one and follows the ' +
        'create_collection contract (including `access`: publicRead/private, mutually exclusive).',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string' }, definition: { type: 'object' } },
        required: ['slug', 'definition'],
      },
      handler: async (args) =>
        collectionsService.updateCollection(
          db,
          principal,
          String(args.slug),
          args.definition as CollectionDefinition,
          now(),
        ),
    });
  }

  // Team discovery — resolve "the tech team" to a team id for share_<slug>.
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

  // Per-collection document tools, filtered by permission.
  for (const def of collections) {
    if (def.slug === 'media') continue; // media has its own tools below
    const publicRead = def.access?.publicRead === true;
    const slug = def.slug;

    if (couldDo(perms, principal, 'read', slug, publicRead)) {
      tools.push({
        name: `list_${slug}`,
        description: `List ${def.name} documents (filter/sort/paginate).`,
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            // lifecycle:'none' collections have no meaningful status axis (B4).
            ...(hasLifecycle(def)
              ? { status: { type: 'string', enum: ['draft', 'published'] } }
              : {}),
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
        },
        handler: async (args) =>
          docs.listDocuments(
            db,
            principal,
            slug,
            {
              page: clampPage(args.page),
              pageSize: clampPageSize(args.pageSize),
              status: args.status as 'draft' | 'published' | undefined,
              sort: parseSort(typeof args.sort === 'string' ? args.sort : undefined),
              filters: filtersFromArgs(args.filters),
            },
            now(),
          ),
      });
      tools.push({
        name: `search_${slug}`,
        description: `Full-text search ${def.name} documents — matches title and body text, relevance-ranked (D28).`,
        inputSchema: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: 'search terms (words are ANDed; the last word prefix-matches)',
            },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
          required: ['q'],
        },
        handler: async (args) => {
          const res = await searchSite(
            db,
            principal,
            {
              q: String(args.q ?? ''),
              collection: slug,
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
      });
      // Collections whose template declares text renders (D47) advertise the
      // `render`/`budget` args; everything else keeps the bare read — the enum
      // derives from code, so schema drift is impossible.
      // `review` (D55) is available on any collection with annotatable fields,
      // to principals who may comment — the brief is the review threads.
      const reviewable =
        comments.hasAnnotatableFields(def) && couldDo(perms, principal, 'comment', slug, false);
      const renders = [...rendersFor(def.template), ...(reviewable ? ['review'] : [])];
      tools.push({
        name: `get_${slug}`,
        description: renders.length
          ? `Get one ${def.name} document by id. Pass \`render\` (${renders.join(', ')}) for a ` +
            `role-tailored markdown brief instead of raw JSON; \`budget\` caps its approximate tokens.`
          : `Get one ${def.name} document by id.`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            ...(renders.length
              ? {
                  render: {
                    type: 'string',
                    enum: [...renders],
                    description: 'Named text render — returns markdown, not JSON.',
                  },
                  budget: {
                    type: 'integer',
                    description: 'Approximate token cap for the render.',
                  },
                }
              : {}),
          },
          required: ['id'],
        },
        handler: async (args) =>
          args.render === 'review' && reviewable
            ? mcpText(
                await comments.renderReview(
                  db,
                  principal,
                  slug,
                  String(args.id),
                  { budget: typeof args.budget === 'number' ? args.budget : undefined },
                  now(),
                ),
              )
            : typeof args.render === 'string'
            ? mcpText(
                await docs.renderDocumentText(
                  db,
                  principal,
                  slug,
                  String(args.id),
                  {
                    render: args.render,
                    budget: typeof args.budget === 'number' ? args.budget : undefined,
                    baseUrl,
                  },
                  now(),
                ),
              )
            : docs.getDocument(db, principal, slug, String(args.id), now()),
      });
      tools.push({
        name: `backlinks_${slug}`,
        description: `List documents that reference a ${def.name} document via relation fields (reverse links — the graph).`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        handler: async (args) => docs.getBacklinks(db, principal, slug, String(args.id), now()),
      });
      tools.push({
        name: `revisions_${slug}`,
        description: `Revision history for a ${def.name} document (newest first — every save appends one).`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        handler: async (args) => docs.listRevisions(db, principal, slug, String(args.id), now()),
      });
    }
    if (couldDo(perms, principal, 'create', slug, false)) {
      tools.push({
        name: `create_${slug}`,
        description: `Create a ${def.name} document.`,
        inputSchema: docInputSchema(def),
        handler: async (args) => docs.createDocument(db, principal, slug, args, now()),
      });
    }
    if (couldDo(perms, principal, 'update', slug, false)) {
      tools.push({
        name: `update_${slug}`,
        description: `Update a ${def.name} document. Provide id + changed fields, and expectedRevision — the \`revision\` from get_${slug} your edit is based on — so a save made on a stale copy fails with STALE_REVISION instead of overwriting newer work (re-read, re-apply, retry).`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            expectedRevision: {
              type: 'integer',
              description: `The revision your edit is based on (from get_${slug}).`,
            },
            ...(comments.hasAnnotatableFields(def)
              ? {
                  resolves: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Review thread ids (threadId from get_' +
                      slug +
                      ' render=review) this save addresses — resolved at the new revision once it saves.',
                  },
                }
              : {}),
            ...(docInputSchema(def).properties as object),
          },
          required: ['id'],
        },
        handler: async (args) => {
          const { id, expectedRevision, resolves, ...rest } = args;
          const threadIds = stringList(resolves, 'resolves');
          // Check the threads BEFORE saving, so a bad id can't leave a saved
          // document with the threads it claimed to address still open.
          if (threadIds.length) {
            await comments.assertResolvable(db, principal, slug, String(id), threadIds, now());
          }
          const doc = await docs.updateDocument(db, principal, slug, String(id), rest, now(), {
            expectedRevision: docs.parseExpectedRevision(expectedRevision),
          });
          if (threadIds.length) {
            await comments.resolveThreads(db, principal, slug, String(id), threadIds, now());
          }
          return threadIds.length ? { ...doc, resolvedThreads: threadIds } : doc;
        },
      });
      tools.push({
        name: `restore_${slug}`,
        description: `Restore a prior revision of a ${def.name} document as a new save (history is preserved — see revisions_${slug}).`,
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, revision: { type: 'integer' } },
          required: ['id', 'revision'],
        },
        handler: async (args) =>
          docs.restoreRevision(db, principal, slug, String(args.id), Number(args.revision), now()),
      });
    }
    if (comments.hasAnnotatableFields(def) && couldDo(perms, principal, 'comment', slug, false)) {
      tools.push({
        name: `comments_${slug}`,
        description: `Review threads on a ${def.name} document as JSON (roots with replies, anchors, status). For a readable brief use get_${slug} with render=review.`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['open', 'resolved'] },
            intent: { type: 'string', enum: [...comments.COMMENT_INTENTS] },
          },
          required: ['id'],
        },
        handler: async (args) =>
          comments.listThreads(
            db,
            { kind: 'principal', principal },
            slug,
            String(args.id),
            {
              status: args.status === 'open' || args.status === 'resolved' ? args.status : undefined,
              intent: (comments.COMMENT_INTENTS as readonly unknown[]).includes(args.intent)
                ? (args.intent as comments.CommentIntent)
                : undefined,
            },
            now(),
          ),
      });
      tools.push({
        name: `comment_${slug}`,
        description:
          `Start a review thread on a ${def.name} document. Pass \`quote\` (exact text from the document) to comment on a passage, ` +
          `\`blockId\` to comment on a figure/widget, or neither for a general note. \`visibility\`: internal (default — ` +
          `principals only) or shared (review-link reviewers see it too).`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            body: { type: 'string' },
            quote: { type: 'string' },
            field: { type: 'string', description: 'Field the quote is in (optional — found automatically).' },
            blockId: { type: 'string' },
            intent: { type: 'string', enum: [...comments.COMMENT_INTENTS] },
            visibility: { type: 'string', enum: ['internal', 'shared'] },
          },
          required: ['id', 'body'],
        },
        handler: async (args) => {
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
            slug,
            String(args.id),
            { anchor, body: String(args.body ?? ''), intent: str(args.intent), visibility: str(args.visibility) },
            now(),
          );
        },
      });
      tools.push({
        name: `reply_comment_${slug}`,
        description: `Reply to a review thread on a ${def.name} document.`,
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, threadId: { type: 'string' }, body: { type: 'string' } },
          required: ['id', 'threadId', 'body'],
        },
        handler: async (args) =>
          comments.replyToThread(
            db,
            { kind: 'principal', principal },
            slug,
            String(args.id),
            String(args.threadId),
            { body: String(args.body ?? '') },
            now(),
          ),
      });
      tools.push({
        name: `resolve_comment_${slug}`,
        description: `Resolve a review thread on a ${def.name} document (stamped with the current revision), or reopen it with reopen=true. Prefer update_${slug}'s \`resolves\` when a save addresses the thread.`,
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, threadId: { type: 'string' }, reopen: { type: 'boolean' } },
          required: ['id', 'threadId'],
        },
        handler: async (args) =>
          comments.setThreadResolved(
            db,
            principal,
            slug,
            String(args.id),
            String(args.threadId),
            args.reopen !== true,
            now(),
          ),
      });
    }
    if (couldDo(perms, principal, 'delete', slug, false)) {
      tools.push({
        name: `delete_${slug}`,
        description: `Delete a ${def.name} document. Moves to trash — recoverable by an admin for 30 days, then purged.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        handler: async (args) => {
          await docs.deleteDocument(db, principal, slug, String(args.id), now());
          return { deleted: true, recoverableDays: 30 };
        },
      });
    }
    if (hasLifecycle(def) && couldDo(perms, principal, 'publish', slug, false)) {
      tools.push({
        name: `publish_${slug}`,
        description: `Publish or unpublish a ${def.name} document.`,
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, publish: { type: 'boolean' } },
          required: ['id'],
        },
        handler: async (args) =>
          docs.setPublished(db, principal, slug, String(args.id), args.publish !== false, now()),
      });
      tools.push({
        name: `schedule_${slug}`,
        description: `Schedule a draft ${def.name} document to publish at a future time (D32), or cancel a pending schedule. Provide exactly one of publish_at / cancel.`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            publish_at: {
              type: 'string',
              description: 'ISO-8601 datetime to publish at (drafts only)',
            },
            cancel: { type: 'boolean', description: 'true to clear a pending schedule' },
          },
          required: ['id'],
        },
        handler: async (args) => {
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
            slug,
            String(args.id),
            cancel ? null : String(args.publish_at),
            now(),
          );
        },
      });
    }
    // Visibility (D50) only matters for collections readable by the public —
    // gated on publicRead (like the editor sidebar control), not lifecycle: a
    // lifecycle:'none' document is always 'published', so visibility alone
    // still decides whether the public list/read surfaces show it.
    if (publicRead && couldDo(perms, principal, 'publish', slug, false)) {
      tools.push({
        name: `visibility_${slug}`,
        description: `Set a ${def.name} document's visibility (D50): public (listed everywhere), unlisted (reachable only by its doc_ id link, not listed), or private (no public URL at all — share it via share_link_${slug}). Allowed on drafts too; it takes effect once published.`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            visibility: { type: 'string', enum: [...VISIBILITIES] },
          },
          required: ['id', 'visibility'],
        },
        handler: async (args) =>
          docs.setVisibility(
            db,
            principal,
            slug,
            String(args.id),
            args.visibility as Visibility,
            now(),
          ),
      });
    }
    if (couldDo(perms, principal, 'manage_access', slug, false)) {
      tools.push({
        name: `share_${slug}`,
        description: `Grant a principal, role, or team scoped actions on one ${def.name} document (item grant, optionally expiring).`,
        inputSchema: {
          type: 'object',
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
        },
        handler: async (args) => ({
          id: await grantItem(
            db,
            principal,
            {
              subjectKind:
                args.subjectKind === 'role'
                  ? 'role'
                  : args.subjectKind === 'team'
                    ? 'team'
                    : 'principal',
              subjectId: String(args.subjectId ?? ''),
              documentId: String(args.id ?? ''),
              collection: slug,
              actions: Array.isArray(args.actions) ? (args.actions.map(String) as Action[]) : [],
              expiresAt: typeof args.expiresAt === 'string' ? args.expiresAt : undefined,
            },
            now(),
          ),
        }),
      });
    }
    if (couldDo(perms, principal, 'share_link', slug, false)) {
      tools.push({
        name: `share_link_${slug}`,
        description: `Mint an anonymous, expiring, READ-ONLY share link for one ${def.name} document. Anyone with the URL can open it — no account needed. Expiry is required and clamped to 30 days.`,
        inputSchema: {
          type: 'object',
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
          },
          required: ['id', 'expiresAt'],
        },
        handler: async (args) => {
          const nowIso = now();
          // Validation and the 30-day clamp both live in createShareLink() now
          // (steering: REST follows "the same rules as the MCP tool" — one
          // implementation instead of two hand-copied ones).
          const { grantId, token, hasPassword, label, expiresAt } = await createShareLink(
            db,
            principal,
            {
              collection: slug,
              documentId: String(args.id ?? ''),
              actions: ['read'],
              expiresAt: typeof args.expiresAt === 'string' ? args.expiresAt : undefined,
              maxTtlDays: SHARE_LINK_MAX_TTL_DAYS,
              password: typeof args.password === 'string' && args.password ? args.password : undefined,
              label: typeof args.label === 'string' && args.label ? args.label : undefined,
            },
            ctx.secret ?? '',
            nowIso,
          );
          // The plaintext token intentionally enters the agent's context — that
          // IS the capability; it stays revocable from the Share panel/matrix.
          return { grantId, url: `${baseUrl}/s/${token}`, expiresAt, hasPassword, label };
        },
      });
    }
  }

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
