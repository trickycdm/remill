/**
 * Generate an OpenAPI 3.1 document from the LIVE collection definitions — surface
 * (5) of the schema engine (steering/API_AND_MCP_STANDARDS.md). Never hand-written
 * or hand-patched; each collection's document schema comes from its field types'
 * `jsonSchema` (via the registry). Regenerated on every request, so schema changes
 * appear immediately.
 */

import { jsonSchemaFor } from '@/fields/registry';
import { hasLifecycle } from '@/lib/lifecycle';
import { rendersFor } from '@/templates/renders';
import { hasAnnotatableFields } from '@/lib/anchor/canonical';
import { COMMENT_INTENTS } from '@/db/queries/comments';
import { VISIBILITIES } from '@/lib/visibility';
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

/** Review-thread endpoints (D55) — present on collections with annotatable
 *  (html/markdown) fields; every call requires the `comment` action. */
function commentPaths(slug: string, tag: string): Record<string, unknown> {
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
  const commentId = { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } };
  const json = (properties: Record<string, unknown>, required: string[] = []) => ({
    required: true,
    content: { 'application/json': { schema: { type: 'object', properties, required } } },
  });
  return {
    [`/api/c/${slug}/{id}/comments`]: {
      parameters: [id],
      get: {
        tags: [tag],
        summary: 'List review threads (roots with replies)',
        description: "Requires 'comment' or 'update' on the document (whoever may edit it may read its feedback).",
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'resolved'] } },
          { name: 'intent', in: 'query', schema: { type: 'string', enum: [...COMMENT_INTENTS] } },
        ],
        responses: { '200': { description: 'Threads visible to the caller' } },
      },
      post: {
        tags: [tag],
        summary: 'Start a review thread',
        description:
          'anchor: {kind:"text", quote, field?, prefix?, suffix?, start?, blockId?} | {kind:"block", blockId, field?} | {kind:"document"}; omit for a general comment. A quote not found in the current text falls back to its block, then the document. visibility: internal (default, principals only) | shared (review-link reviewers see it).',
        requestBody: json(
          {
            body: { type: 'string' },
            anchor: { type: 'object' },
            intent: { type: 'string', enum: [...COMMENT_INTENTS] },
            visibility: { type: 'string', enum: ['internal', 'shared'] },
          },
          ['body'],
        ),
        responses: { '201': { description: 'The new thread' } },
      },
    },
    [`/api/c/${slug}/{id}/comments/{commentId}`]: {
      parameters: [id, commentId],
      delete: {
        tags: [tag],
        summary: 'Delete a comment (own, or any with update on the document)',
        responses: { '200': { description: 'Deleted' } },
      },
    },
    [`/api/c/${slug}/{id}/comments/{commentId}/replies`]: {
      parameters: [id, commentId],
      post: {
        tags: [tag],
        summary: 'Reply to a thread',
        requestBody: json({ body: { type: 'string' } }, ['body']),
        responses: { '201': { description: 'The reply' } },
      },
    },
    [`/api/c/${slug}/{id}/comments/{commentId}/resolve`]: {
      parameters: [id, commentId],
      post: {
        tags: [tag],
        summary: 'Resolve (or with {resolved:false} reopen) a thread',
        requestBody: json({ resolved: { type: 'boolean' } }),
        responses: { '200': { description: 'The thread root' } },
      },
    },
  };
}

function collectionPaths(def: CollectionDefinition): Record<string, unknown> {
  const ref = { $ref: `#/components/schemas/${def.slug}` };
  const tag = def.name;
  const body = { required: true, content: { 'application/json': { schema: ref } } };
  const listItem = { type: 'object', properties: { data: ref } };
  // lifecycle:'none' collections advertise no status filter and no publish path (B4).
  const lifecycle = hasLifecycle(def);
  // Visibility (D50) only matters for collections readable by the public.
  const publicRead = def.access?.publicRead === true;
  // Collections whose template declares text renders advertise ?render=/&budget= (D47);
  // any collection with annotatable fields adds the `review` render and the
  // comment endpoints (D55).
  const annotatable = hasAnnotatableFields(def);
  const renders = [...rendersFor(def.template), ...(annotatable ? ['review'] : [])];
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
        ...(renders.length
          ? {
              parameters: [
                {
                  name: 'render',
                  in: 'query',
                  schema: { type: 'string', enum: [...renders] },
                  description:
                    'Named text render (D47) — returns a role-tailored text/markdown brief instead of JSON.',
                },
                {
                  name: 'budget',
                  in: 'query',
                  schema: { type: 'integer' },
                  description: 'Approximate token cap for the render.',
                },
              ],
            }
          : {}),
        responses: {
          '200': {
            description: 'The document',
            headers: {
              ETag: {
                description: 'The current revision (D54) — send it back as If-Match on PATCH.',
                schema: { type: 'string' },
              },
            },
          },
        },
      },
      patch: {
        tags: [tag],
        summary: `Update a ${def.name}`,
        parameters: [
          {
            name: 'If-Match',
            in: 'header',
            schema: { type: 'string' },
            description:
              'The revision this edit is based on (the ETag from GET). A stale value fails with 409 STALE_REVISION instead of overwriting newer work (D54).',
          },
        ],
        requestBody: body,
        responses: {
          '200': { description: 'Updated' },
          '409': { description: 'STALE_REVISION — the document changed since the If-Match revision' },
        },
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
    ...(publicRead
      ? {
          [`/api/c/${def.slug}/{id}/visibility`]: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            post: {
              tags: [tag],
              summary: `Set ${def.name} visibility (D50)`,
              description:
                'Body {visibility: "public"|"unlisted"|"private"}. Requires the publish action. Allowed on drafts (remembered until publish). Unlisted/private drop out of public lists (index/RSS/sitemap/search/backlinks) and unlisted is only reachable by its doc_ id URL; private has no public URL at all.',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { visibility: { type: 'string', enum: [...VISIBILITIES] } },
                      required: ['visibility'],
                    },
                  },
                },
              },
              responses: {
                '200': { description: 'Updated (returns the document with visibility)' },
              },
            },
          },
        }
      : {}),
    ...(annotatable ? commentPaths(def.slug, tag) : {}),
    [`/api/c/${def.slug}/{id}/revisions`]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: [tag],
        summary: `Revision history`,
        responses: { '200': { description: 'Revisions' } },
      },
    },
    [`/api/c/${def.slug}/{id}/share-links`]: {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: [tag],
        summary: `List ${def.name} share links (D51)`,
        description:
          'Requires the share_link action. Returns active link grants (no password hashes), each with a re-copyable `url` (D53; null for a legacy link or a decryption failure).',
        responses: { '200': { description: 'Share links, each including url' } },
      },
      post: {
        tags: [tag],
        summary: `Mint a read-only share link for a ${def.name} document (D51)`,
        description:
          'Body {expiresAt?, password?, label?}. password (min 8 chars) requires the link to be unlocked before it opens; label is a human note shown in the Share panel. Requires the share_link action.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  expiresAt: { type: 'string' },
                  password: { type: 'string' },
                  label: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created {grantId, url, expiresAt, hasPassword, label}' },
        },
      },
    },
    [`/api/c/${def.slug}/{id}/share-links/{grantId}`]: {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'grantId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      delete: {
        tags: [tag],
        summary: `Revoke a ${def.name} share link (D51)`,
        description: 'Requires the share_link action. Rejects grant ids that are not a link grant on this document.',
        responses: { '200': { description: 'Revoked' } },
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
    '/api/me': {
      get: {
        tags: ['Access'],
        summary: 'Who am I',
        description:
          "The caller's principal, role assignments, the permissions they resolve to (collection, action, condition), token scope mask, and OAuth client. Identity-scoped: reveals only what the caller holds. MCP parity: whoami.",
        responses: { '200': { description: '{data: {principal, roles, permissions, tokenScope, oauthClient}}' } },
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

/** `defs` are supplied by the caller (the route resolves the requesting
 *  principal and passes its DISCOVERABLE collections, D46) — this module stays
 *  below the services layer and never reads the DB itself. */
export function generateOpenApi(
  defs: readonly CollectionDefinition[],
  baseUrl: string,
): Record<string, unknown> {
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
