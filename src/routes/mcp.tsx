import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { getDb } from '@/db/client';
import { resolvePrincipal } from '@/lib/api-auth';
import { assertBodyWithinLimit, MAX_MCP_BODY_BYTES } from '@/lib/api';
import { handleMcp } from '@/mcp/handler';
import type { McpToolContext } from '@/mcp/tools';
import { consumeRateLimit, clientKey, UPLOAD_RATE_LIMIT } from '@/middleware/rate-limit';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
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
  // SEC-4: reject oversized JSON-RPC bodies before parsing. The MCP cap is
  // higher than REST's (D34) because upload_media carries base64 file content.
  assertBodyWithinLimit(c, MAX_MCP_BODY_BYTES);
  const db = getDb(c.env.DB);
  const principal = await resolvePrincipal(db, c, 'mcp', nowIso());

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequestError('MCP request body must be JSON-RPC.');
  }

  // Tools that mint absolute URLs (share_link_<slug>) have no request Context —
  // resolve the base once per request and thread it through. Same for the R2
  // bucket + the upload rate limiter (keyed to the token, else the client IP —
  // shared 'upload' bucket with REST, D34).
  const baseUrl = resolveBaseUrl(c.env, await getSettings(db), c.req.url);
  const ctx: McpToolContext = {
    media: c.env.MEDIA,
    consumeUploadLimit: () =>
      consumeRateLimit(
        c.env.RATE_LIMIT,
        'upload',
        UPLOAD_RATE_LIMIT,
        principal.tokenId ?? clientKey(c),
      ),
  };

  // Support a single request or a batch.
  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(body.map((m) => handleMcp(db, principal, nowIso, m, baseUrl, ctx)))
    ).filter(Boolean);
    return responses.length ? c.json(responses) : c.body(null, 202);
  }
  const response = await handleMcp(db, principal, nowIso, body as never, baseUrl, ctx);
  return response ? c.json(response) : c.body(null, 202);
});
