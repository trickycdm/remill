import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { publishPage } from '@/services/pages';
import { pageInputFrom } from '@/lib/pages-http';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/**
 * POST /api/pages — publish a standalone HTML page (D62) into the built-in
 * pages collection. Send the page as `text/html` (metadata in the query
 * string) or as JSON `{ html, title?, description?, tags?, share? }` — the
 * same object the MCP `publish_page` tool takes; both go through
 * `publishPage`. Requires `create` on the pages collection. 201 with
 * `{ id, url, title, revision, visibility, share, warnings }`.
 */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const db = getDb(c.env.DB);
  const principal = await apiPrincipal(c, now);
  const input = await pageInputFrom(c);
  const baseUrl = resolveBaseUrl(c.env, await getSettings(db), c.req.url);
  const page = await publishPage(
    db,
    principal,
    input,
    { secret: c.env.SESSION_SECRET, baseUrl },
    now,
  );
  c.header('ETag', `"${page.revision}"`);
  return apiJson(c, { data: page }, 201);
});
