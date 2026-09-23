import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { createShareLink, listShareLinks } from '@/services/access';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** GET /api/c/:collection/:id/share-links — list active link grants on this
 *  document (`share_link`; no hashes), each with its re-copyable `url` (D53,
 *  null for a legacy link or a decryption failure). */
export const onRequestGet = factory.createHandlers(async (c) => {
  const now = nowIso();
  const db = getDb(c.env.DB);
  const settings = await getSettings(db);
  const links = await listShareLinks(
    db,
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    c.env.SESSION_SECRET,
    resolveBaseUrl(c.env, settings, c.req.url),
    now,
  );
  return apiJson(c, { data: links });
});

/** Same rule the MCP `share_link_<slug>` tool enforces (steering
 *  API_AND_MCP_STANDARDS.md): `expiresAt` is REQUIRED and clamped to 30 days. */
const SHARE_LINK_MAX_TTL_DAYS = 30;

/**
 * POST /api/c/:collection/:id/share-links — mint a read-only share link.
 * Body: `{ expiresAt, password?, label? }`. `expiresAt` is required, clamped to
 * 30 days out — the same rules as the MCP `share_link_<slug>` tool.
 */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const db = getDb(c.env.DB);
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const principal = await apiPrincipal(c, now);
  const { grantId, token, hasPassword, label, expiresAt } = await createShareLink(
    db,
    principal,
    {
      collection: pathParam(c, 'collection'),
      documentId: pathParam(c, 'id'),
      actions: ['read'],
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
      maxTtlDays: SHARE_LINK_MAX_TTL_DAYS,
      password: typeof body.password === 'string' && body.password ? body.password : undefined,
      label: typeof body.label === 'string' && body.label ? body.label : undefined,
    },
    c.env.SESSION_SECRET,
    now,
  );
  const settings = await getSettings(db);
  const url = `${resolveBaseUrl(c.env, settings, c.req.url)}/s/${token}`;
  return apiJson(c, { data: { grantId, url, expiresAt, hasPassword, label } }, 201);
});
