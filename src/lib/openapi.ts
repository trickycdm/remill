/**
 * Generate an OpenAPI 3.1 document from the LIVE collection definitions — surface
 * (5) of the schema engine (steering/API_AND_MCP_STANDARDS.md). Never hand-written
 * or hand-patched; each collection's document schema comes from its field types'
 * `jsonSchema` (via the registry). Regenerated on every request, so schema changes
 * appear immediately.
 */

import type { Database } from '@/db/client';
import { listCollections } from '@/db/queries/collections';
import { jsonSchemaFor } from '@/fields/registry';
import { hasLifecycle } from '@/lib/lifecycle';
import type { CollectionDefinition, JSONSchema } from '@/fields/types';

function documentSchema(def: CollectionDefinition): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const field of def.fields) {
    properties[field.key] = jsonSchemaFor(field);
    if (field.required) required.push(field.key);
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function collectionPaths(def: CollectionDefinition): Record<string, unknown> {
  const ref = { $ref: `#/components/schemas/${def.slug}` };
  const tag = def.name;
  const body = { required: true, content: { 'application/json': { schema: ref } } };
  const listItem = { type: 'object', properties: { data: ref } };
  // lifecycle:'none' collections advertise no status filter and no publish path (B4).
  const lifecycle = hasLifecycle(def);
  return {
    [`/api/c/${def.slug}`]: {
      get: {
        tags: [tag],
        summary: `List ${def.name}`,
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
          ...(lifecycle
            ? [
                {
                  name: 'status',
                  in: 'query',
                  schema: { type: 'string', enum: ['draft', 'published'] },
                },
              ]
            : []),
          { name: 'sort', in: 'query', schema: { type: 'string' } },
          {
            name: 'q',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Full-text search (D28): words are ANDed, the last word prefix-matches; results are relevance-ranked (so `sort` cannot combine with `q`). Response items carry {id, title, snippet, status}.',
          },
          {
            name: 'filter',
            in: 'query',
            style: 'deepObject',
            explode: true,
            schema: { type: 'object', additionalProperties: { type: 'string' } },
            description:
              'Filters on indexed fields: filter[field]=v (exact) or filter[field][op]=v with op one of eq/gte/lte/contains/in (in: comma-separated values; contains: text fields only — note markdown/html index a 200-char lead-in).',
          },
        ],
        responses: { '200': { description: 'A page of documents' } },
      },
      post: {
        tags: [tag],
        summary: `Create a ${def.name}`,
        requestBody: body,
        responses: {
          '201': { description: 'Created', content: { 'application/json': { schema: listItem } } },
        },
      },
    },
    [`/api/c/${def.slug}/{id}`]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: [tag],
        summary: `Get a ${def.name}`,
        responses: { '200': { description: 'The document' } },
      },
      patch: {
        tags: [tag],
        summary: `Update a ${def.name}`,
        requestBody: body,
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: [tag],
        summary: `Delete a ${def.name}`,
        responses: { '200': { description: 'Deleted' } },
      },
    },
    ...(lifecycle
      ? {
          [`/api/c/${def.slug}/{id}/publish`]: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            post: {
              tags: [tag],
              summary: `Publish/unpublish a ${def.name}`,
              responses: { '200': { description: 'Updated' } },
            },
          },
          [`/api/c/${def.slug}/{id}/schedule`]: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            post: {
              tags: [tag],
              summary: `Schedule a draft ${def.name} to publish later (D32)`,
              description:
                'Body {publishAt: ISO-8601 | null}. null cancels. Drafts only; requires the publish action. The per-minute cron publishes due drafts as the system actor.',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { publishAt: { type: ['string', 'null'] } },
                      required: ['publishAt'],
                    },
                  },
                },
              },
              responses: {
                '200': { description: 'Updated (returns the document with publishAt)' },
              },
            },
          },
        }
      : {}),
    [`/api/c/${def.slug}/{id}/revisions`]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: [tag],
        summary: `Revision history`,
        responses: { '200': { description: 'Revisions' } },
      },
    },
    [`/api/c/${def.slug}/export`]: {
      get: {
        tags: [tag],
        summary: `Export ${def.name} as NDJSON (D37)`,
        description:
          'Line 1: {kind:"remill-export", version:1, exportedAt, collection: <definition>}; then one {kind:"document", id, status, data, createdAt, updatedAt, publishedAt, createdBy} per line. Bounded by YOUR read filter — you export what you can read.',
        responses: { '200': { description: 'application/x-ndjson' } },
      },
    },
    [`/api/c/${def.slug}/import`]: {
      post: {
        tags: [tag],
        summary: `Import an NDJSON export into ${def.name} (D37)`,
        description:
          'Upsert by preserved id through the full validated pipeline (per-item authorize; status "published" lines additionally require the publish action). Header def slug must match this collection. Body cap 10 MiB — split larger imports. ?dryRun=1 validates without writing. Response {created, updated, failed, errors:[{line, id?, error}]} — per-line errors, the run never aborts.',
        parameters: [{ name: 'dryRun', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        requestBody: {
          required: true,
          content: { 'application/x-ndjson': { schema: { type: 'string' } } },
        },
        responses: { '200': { description: 'Import summary' } },
      },
    },
  };
}

/** Fixed (non-generated) endpoints — hand-listed because generateOpenApi only
 *  iterates collection definitions. Extend when adding a static /api route. */
function staticPaths(): Record<string, unknown> {
  const trashTag = 'Trash';
  return {
    '/api/templates': {
      get: {
        tags: ['Packs'],
        summary: 'List the reading templates (D42)',
        description:
          "The render-template registry a collection's `template` key selects from. Ungated discovery.",
        responses: { '200': { description: 'Template metadata (key, name, description)' } },
      },
    },
    '/api/packs': {
      get: {
        tags: ['Packs'],
        summary: 'List the installable content packs (D42)',
        description:
          'Each pack bundles a reading template with co-designed collection definition(s); includes installed status. Ungated discovery.',
        responses: { '200': { description: 'Pack metadata + installed status' } },
      },
    },
    '/api/packs/{key}/install': {
      parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: ['Packs'],
        summary: 'Install a content pack (manage_schema)',
        description:
          "Creates the pack's collection(s) through the standard validated pipeline. Optional body { slug } renames a single-collection pack's scaffold.",
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { slug: { type: 'string' } } },
            },
          },
        },
        responses: {
          '201': { description: 'The created collection definition(s)' },
          '409': { description: 'A target collection already exists' },
        },
      },
    },
    '/api/trash': {
      get: {
        tags: [trashTag],
        summary: 'List trashed documents (D29)',
        description:
          'Trashed documents across every collection the caller can delete (own/published conditions applied). Entries are purged after 30 days.',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Trash entries, newest deletions first' } },
      },
    },
    '/api/trash/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      delete: {
        tags: [trashTag],
        summary: 'Permanently delete a trash entry',
        responses: { '200': { description: 'Deleted forever' } },
      },
    },
    '/api/audit': {
      get: {
        tags: ['Audit'],
        summary: 'Query the audit trail (manage_access)',
        description:
          'Every authorization decision (allow and deny) across admin/REST/MCP. Keyset-paginated via nextCursor.',
        parameters: [
          { name: 'principal', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'collection', in: 'query', schema: { type: 'string' } },
          { name: 'result', in: 'query', schema: { type: 'string', enum: ['allow', 'deny'] } },
          {
            name: 'surface',
            in: 'query',
            schema: { type: 'string', enum: ['admin', 'rest', 'mcp', 'system'] },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Audit rows, newest first, with nextCursor' } },
      },
    },
    '/api/trash/{id}/restore': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      post: {
        tags: [trashTag],
        summary: 'Restore a trashed document under its original id',
        responses: {
          '200': { description: 'Restored' },
          '409': { description: 'Collection gone, or id/unique value re-taken since deletion' },
        },
      },
    },
    '/api/events': {
      get: {
        tags: ['Events'],
        summary: 'Poll the change feed (D33)',
        description:
          'Pointer events (type, collection, resource id, actor, time — no payload) after `since`, oldest first, filtered to collections you can read. Response {data, nextSince}: pass nextSince back as since. Events prune after 30 days — seq gaps are normal; re-fetch content via the read endpoints.',
        parameters: [
          { name: 'since', in: 'query', schema: { type: 'integer', minimum: 0 } },
          { name: 'collection', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
        ],
        responses: { '200': { description: 'Events after `since`, oldest first, with nextSince' } },
      },
    },
  };
}

export async function generateOpenApi(
  db: Database,
  baseUrl: string,
): Promise<Record<string, unknown>> {
  const defs = await listCollections(db);
  const paths: Record<string, unknown> = staticPaths();
  const schemas: Record<string, JSONSchema> = {};
  for (const def of defs) {
    Object.assign(paths, collectionPaths(def));
    schemas[def.slug] = documentSchema(def);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'remill CMS API',
      version: '1.0.0',
      description: 'Generated from live collection definitions.',
    },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      schemas,
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
    security: [{ bearer: [] }],
  };
}
