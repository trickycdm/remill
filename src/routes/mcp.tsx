import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { resolvePrincipal } from '@/lib/api-auth';
import { assertBodyWithinLimit } from '@/lib/api';
import { handleMcp } from '@/mcp/handler';
import { nowIso } from '@/lib/now';
import { BadRequestError } from '@/lib/errors';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /mcp — the MCP server over streamable HTTP (JSON-RPC). Authenticated with
 * the same bearer tokens as REST; tools are generated per collection and filtered
 * to the connecting principal's permissions (src/mcp/). See the transport note in
 * src/mcp/handler.ts.
 */
export const onRequestPost = factory.createHandlers(async (c) => {
  assertBodyWithinLimit(c); // SEC-4: reject oversized JSON-RPC bodies before parsing.
  const db = getDb(c.env.DB);
  const principal = await resolvePrincipal(db, c, 'mcp', nowIso());

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequestError('MCP request body must be JSON-RPC.');
  }

  // Support a single request or a batch.
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handleMcp(db, principal, nowIso, m)))).filter(Boolean);
    return responses.length ? c.json(responses) : c.body(null, 202);
  }
  const response = await handleMcp(db, principal, nowIso, body as never);
  return response ? c.json(response) : c.body(null, 202);
});
