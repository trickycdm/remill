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
import { getPrincipalPermissions, grantItem, listTeams, createShareLink, listAuditPage } from '@/services/access';
import { InputValidationError } from '@/lib/errors';
import { listCollections, getCollection, listCollectionsForDiscovery } from '@/services/collections';
import * as docs from '@/services/documents';
import * as collectionsService from '@/services/collections';
import { listMedia, getMediaById, uploadMedia } from '@/services/media';
import { searchSite } from '@/services/search';
import { snippetToText } from '@/lib/fts';
import { decodeBase64 } from '@/lib/base64';
import { parseSort, clampPage, clampPageSize } from '@/lib/list-query';
import { hasLifecycle } from '@/lib/lifecycle';
import { jsonSchemaFor } from '@/fields/registry';
import type { CollectionDefinition, JSONSchema } from '@/fields/types';

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Request-scoped capabilities tools need beyond the DB (threaded from the /mcp
 *  route — this module has no Context). `media` is the R2 bucket for
 *  `upload_media` (absent in tests without R2 → the tool is not offered);
 *  `consumeUploadLimit` shares REST's 'upload' rate bucket, keyed to the caller
 *  (tokenId, else client IP) — D34. */
export interface McpToolContext {
  readonly media?: R2Bucket;
  readonly consumeUploadLimit?: () => Promise<unknown>;
}

/** Whether `principal` could ever perform `action` on `collection` — for tool
 *  VISIBILITY. The handler re-authorizes per call (with conditions), so showing a
 *  conditionally-available tool is fine. Honors the token scope mask. */
function couldDo(
  perms: { collection: string; action: Action; condition: unknown }[],
  principal: Principal,
  action: Action,
  collection: string,
  publicRead: boolean,
): boolean {
  const scope = principal.tokenScope;
  if (scope && !scopeMatches(scope, action, collection)) return false;
  if (action === 'read' && publicRead) return true;
  return perms.some((p) => p.action === action && (p.collection === '*' || p.collection === collection));
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
const SHARE_LINK_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  if (couldDo(perms, principal, 'manage_schema', '*', false)) {
    tools.push({
      name: 'create_collection',
      description: 'Define a new content type. The body is a collection definition (slug, name, shape, fields[]).',
      inputSchema: { type: 'object', properties: { definition: { type: 'object' } }, required: ['definition'] },
      handler: async (args) =>
        collectionsService.createCollection(db, principal, args.definition as CollectionDefinition, now()),
    });
    tools.push({
      name: 'update_collection',
      description: 'Modify an existing content type.',
      inputSchema: { type: 'object', properties: { slug: { type: 'string' }, definition: { type: 'object' } }, required: ['slug', 'definition'] },
      handler: async (args) =>
        collectionsService.updateCollection(db, principal, String(args.slug), args.definition as CollectionDefinition, now()),
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
            ...(hasLifecycle(def) ? { status: { type: 'string', enum: ['draft', 'published'] } } : {}),
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
            q: { type: 'string', description: 'search terms (words are ANDed; the last word prefix-matches)' },
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
      tools.push({
        name: `get_${slug}`,
        description: `Get one ${def.name} document by id.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        handler: async (args) => docs.getDocument(db, principal, slug, String(args.id), now()),
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
        description: `Update a ${def.name} document. Provide id + changed fields.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...docInputSchema(def).properties as object }, required: ['id'] },
        handler: async (args) => {
          const { id, ...rest } = args;
          return docs.updateDocument(db, principal, slug, String(id), rest, now());
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
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, publish: { type: 'boolean' } }, required: ['id'] },
        handler: async (args) => docs.setPublished(db, principal, slug, String(args.id), args.publish !== false, now()),
      });
      tools.push({
        name: `schedule_${slug}`,
        description: `Schedule a draft ${def.name} document to publish at a future time (D32), or cancel a pending schedule. Provide exactly one of publish_at / cancel.`,
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            publish_at: { type: 'string', description: 'ISO-8601 datetime to publish at (drafts only)' },
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
          return docs.scheduleDocument(db, principal, slug, String(args.id), cancel ? null : String(args.publish_at), now());
        },
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
            actions: { type: 'array', items: { type: 'string' }, description: 'actions to grant, e.g. ["read"]' },
            expiresAt: { type: 'string', description: 'optional ISO-8601 expiry' },
          },
          required: ['id', 'subjectKind', 'subjectId', 'actions'],
        },
        handler: async (args) => ({
          id: await grantItem(
            db,
            principal,
            {
              subjectKind: args.subjectKind === 'role' ? 'role' : args.subjectKind === 'team' ? 'team' : 'principal',
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
            expiresAt: { type: 'string', description: 'REQUIRED ISO-8601 expiry (clamped to 30 days out)' },
          },
          required: ['id', 'expiresAt'],
        },
        handler: async (args) => {
          const requested = Date.parse(String(args.expiresAt ?? ''));
          if (Number.isNaN(requested)) {
            throw new InputValidationError([{ path: 'expiresAt', message: 'A valid ISO-8601 expiry is required.' }]);
          }
          const nowIso = now();
          const expiresAt = new Date(Math.min(requested, new Date(nowIso).getTime() + SHARE_LINK_MAX_TTL_MS)).toISOString();
          const { grantId, token } = await createShareLink(
            db,
            principal,
            { collection: slug, documentId: String(args.id ?? ''), actions: ['read'], expiresAt },
            nowIso,
          );
          // The plaintext token intentionally enters the agent's context — that
          // IS the capability; it stays revocable from the Share panel/matrix.
          return { grantId, url: `${baseUrl}/s/${token}`, expiresAt };
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
        return { id: rec.id, url: `/media/${rec.id}`, mime: rec.mime, size: rec.size, alt: rec.alt };
      },
    });
  }

  // Media read tools.
  if (couldDo(perms, principal, 'read', 'media', (await getCollection(db, 'media'))?.access?.publicRead === true)) {
    tools.push({
      name: 'list_media',
      description: 'List uploaded media assets (newest first; pass the returned cursor for the next page).',
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
          { cursor: typeof args.cursor === 'string' ? args.cursor : null, limit: args.pageSize as number | undefined },
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

  return tools;
}
