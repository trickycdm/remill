/**
 * MCP tool generation — surface (6) of the schema engine
 * (steering/API_AND_MCP_STANDARDS.md). Tools are GENERATED per collection from the
 * same field descriptors as every other surface, and the set is INTERSECTED with
 * the connecting principal's effective permissions: an agent without `publish`
 * never sees `publish_<slug>`. Capability discovery IS permission discovery.
 *
 * This module is SDK-agnostic and unit-testable: it returns plain tool descriptors
 * with async handlers that call the same services as admin/REST — one pipeline,
 * three doors. The thin `agents`-SDK wiring (src/mcp/agent.ts) registers them.
 */

import type { Database } from '@/db/client';
import type { Principal, Action } from '@/access';
// COR-6: the MCP surface must go through SERVICES, never the queries layer directly.
import { getPrincipalPermissions } from '@/services/access';
import { listCollections, getCollection, listCollectionsForDiscovery } from '@/services/collections';
import * as docs from '@/services/documents';
import * as collectionsService from '@/services/collections';
import { listMedia, getMediaById } from '@/services/media';
import { parseSort, clampPage, clampPageSize } from '@/lib/list-query';
import { jsonSchemaFor } from '@/fields/registry';
import type { CollectionDefinition, JSONSchema } from '@/fields/types';

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly handler: (args: Record<string, unknown>) => Promise<unknown>;
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
  if (scope && !scope.some((s) => s.action === action && (s.collection === '*' || s.collection === collection))) {
    return false;
  }
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

/** Build the permission-filtered tool set for a principal. */
export async function buildToolsForPrincipal(
  db: Database,
  principal: Principal,
  now: () => string,
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
            status: { type: 'string', enum: ['draft', 'published'] },
            sort: { type: 'string', description: 'indexed field name, prefix "-" for descending' },
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
            },
            now(),
          ),
      });
      tools.push({
        name: `get_${slug}`,
        description: `Get one ${def.name} document by id.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        handler: async (args) => docs.getDocument(db, principal, slug, String(args.id), now()),
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
    }
    if (couldDo(perms, principal, 'publish', slug, false)) {
      tools.push({
        name: `publish_${slug}`,
        description: `Publish or unpublish a ${def.name} document.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, publish: { type: 'boolean' } }, required: ['id'] },
        handler: async (args) => docs.setPublished(db, principal, slug, String(args.id), args.publish !== false, now()),
      });
    }
  }

  // Media (read tools; upload is out of band — binary, not JSON-RPC).
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
