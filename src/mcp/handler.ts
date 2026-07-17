/**
 * MCP JSON-RPC dispatch (steering/API_AND_MCP_STANDARDS.md). Handles the MCP
 * methods over streamable HTTP: initialize, tools/list, tools/call, resources/*.
 * The permission-filtered tool set comes from src/mcp/tools.ts; every tool call
 * runs through the same services as admin/REST (one pipeline, three doors).
 *
 * TRANSPORT NOTE (deviation from D10, done per §8): the plan specified an McpAgent
 * on a Durable Object via the Cloudflare `agents` SDK. We instead serve MCP as a
 * direct streamable-HTTP JSON-RPC endpoint here. Rationale: the `agents` SDK is
 * fast-moving (a §8 watch-item) and its bearer-auth prop injection is version-
 * fragile; a stateless generated-tool server needs no DO session state. All the
 * load-bearing properties — tools generated from field descriptors, intersected
 * with the principal's permissions, routed through the shared service pipeline —
 * are preserved and unit-tested. The registration surface stays in this one thin
 * module, exactly the containment §8 asks for.
 */

import type { Database } from '@/db/client';
import type { Principal } from '@/access';
import { buildToolsForPrincipal, type McpToolContext } from '@/mcp/tools';
import { getPromptForPrincipal, listPromptsForPrincipal } from '@/mcp/prompts';
import { listCollections } from '@/services/collections';
import { getDocument, listDocuments } from '@/services/documents';
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function result(id: JsonRpcRequest['id'], value: unknown) {
  return { jsonrpc: '2.0' as const, id, result: value };
}
function error(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0' as const, id, error: { code, message, ...(data ? { data } : {}) } };
}

export async function handleMcp(
  db: Database,
  principal: Principal,
  now: () => string,
  reqBody: JsonRpcRequest,
  baseUrl = '',
  ctx: McpToolContext = {},
): Promise<object | null> {
  const { id, method, params } = reqBody;

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'remill', version: '1.0.0' },
      });

    case 'notifications/initialized':
    case 'ping':
      return id === undefined ? null : result(id, {});

    case 'tools/list': {
      const tools = await buildToolsForPrincipal(db, principal, now, baseUrl, ctx);
      return result(id, {
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    }

    case 'tools/call': {
      const name = String(params?.name ?? '');
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const tools = await buildToolsForPrincipal(db, principal, now, baseUrl, ctx);
      const tool = tools.find((t) => t.name === name);
      // A tool the principal can't see is, in effect, forbidden — don't leak its
      // existence differently from a permission denial.
      if (!tool) {
        return result(id, {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown or unavailable tool '${name}'`, code: 'FORBIDDEN' }) }],
        });
      }
      try {
        const value = await tool.handler(args);
        return result(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
      } catch (err) {
        // Return errors as tool results (isError) so the agent can reason about
        // them — including the structured 403 with `missing`.
        const payload =
          err instanceof ForbiddenError
            ? { error: err.friendlyMessage, code: err.code, missing: err.missing }
            : err instanceof AppError
              ? { error: err.friendlyMessage, code: err.code, details: err.details }
              : { error: 'Internal error', code: 'INTERNAL_ERROR' };
        return result(id, { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] });
      }
    }

    case 'resources/list': {
      // Published documents of publicRead collections, exposed as resources.
      const defs = (await listCollections(db)).filter((d) => d.access?.publicRead && d.slug !== 'media');
      const resources: { uri: string; name: string; mimeType: string }[] = [];
      for (const def of defs) {
        const { rows } = await listDocuments(db, principal, def.slug, { status: 'published', pageSize: 50 }, now());
        for (const doc of rows) {
          resources.push({ uri: `remill://${def.slug}/${doc.id}`, name: `${def.name} ${doc.id}`, mimeType: 'application/json' });
        }
      }
      return result(id, { resources });
    }

    case 'resources/read': {
      const uri = String(params?.uri ?? '');
      const m = /^remill:\/\/([^/]+)\/(.+)$/.exec(uri);
      if (!m) return error(id, -32602, 'Invalid resource uri');
      const doc = await getDocument(db, principal, m[1], m[2], now());
      return result(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(doc, null, 2) }] });
    }

    case 'prompts/list': {
      // Published items of prompt-shaped collections (D44). Single-page: we
      // ignore params.cursor and omit nextCursor — spec-compliant, and since we
      // never issue cursors a client can never hold a valid one.
      const prompts = await listPromptsForPrincipal(db, principal, now);
      return result(id, { prompts });
    }

    case 'prompts/get': {
      const name = String(params?.name ?? '');
      const rawArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      const args = Object.fromEntries(
        Object.entries(rawArgs).map(([k, v]) => [k, String(v)]),
      );
      try {
        return result(id, await getPromptForPrincipal(db, principal, name, args, now));
      } catch (err) {
        // Unknown, unpublished, non-prompt, and forbidden are ONE shape — a
        // prompt the principal can't see must not exist differently from one
        // that doesn't exist (the tools/call FORBIDDEN posture).
        if (err instanceof NotFoundError || err instanceof ForbiddenError) {
          return error(id, -32602, `Unknown prompt: ${name}`);
        }
        throw err;
      }
    }

    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}
