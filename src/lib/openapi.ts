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
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
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
          ...(lifecycle ? [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'published'] } }] : []),
          { name: 'sort', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'A page of documents' } },
      },
      post: { tags: [tag], summary: `Create a ${def.name}`, requestBody: body, responses: { '201': { description: 'Created', content: { 'application/json': { schema: listItem } } } } },
    },
    [`/api/c/${def.slug}/{id}`]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: [tag], summary: `Get a ${def.name}`, responses: { '200': { description: 'The document' } } },
      patch: { tags: [tag], summary: `Update a ${def.name}`, requestBody: body, responses: { '200': { description: 'Updated' } } },
      delete: { tags: [tag], summary: `Delete a ${def.name}`, responses: { '200': { description: 'Deleted' } } },
    },
    ...(lifecycle
      ? {
          [`/api/c/${def.slug}/{id}/publish`]: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            post: { tags: [tag], summary: `Publish/unpublish a ${def.name}`, responses: { '200': { description: 'Updated' } } },
          },
        }
      : {}),
    [`/api/c/${def.slug}/{id}/revisions`]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: [tag], summary: `Revision history`, responses: { '200': { description: 'Revisions' } } },
    },
  };
}

export async function generateOpenApi(db: Database, baseUrl: string): Promise<Record<string, unknown>> {
  const defs = await listCollections(db);
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, JSONSchema> = {};
  for (const def of defs) {
    Object.assign(paths, collectionPaths(def));
    schemas[def.slug] = documentSchema(def);
  }
  return {
    openapi: '3.1.0',
    info: { title: 'remill CMS API', version: '1.0.0', description: 'Generated from live collection definitions.' },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      schemas,
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
    security: [{ bearer: [] }],
  };
}
