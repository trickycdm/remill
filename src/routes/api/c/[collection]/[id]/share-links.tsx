import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { listShareLinks } from '@/services/access';
import { mintApiShareLink } from '@/services/sharing';
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

/**
 * POST /api/c/:collection/:id/share-links — mint a share link. Body:
 * `{ expiresAt, password?, label?, review?: { mode?, reviewer? } }`. Read-only
 * by default; `review` makes it a review link whose holders can also comment
 * (D61). `expiresAt` is required and clamped to 30 days. The rules live in
 * `mintApiShareLink` — the same function the MCP `share_link_<slug>` tool calls.
 */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const db = getDb(c.env.DB);
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const principal = await apiPrincipal(c, now);
  const { token, ...link } = await mintApiShareLink(
    db,
    principal,
    {
      collection: pathParam(c, 'collection'),
      documentId: pathParam(c, 'id'),
      expiresAt: body.expiresAt,
      password: body.password,
      label: body.label,
      review: body.review,
    },
    c.env.SESSION_SECRET,
    now,
  );
  const settings = await getSettings(db);
  const url = `${resolveBaseUrl(c.env, settings, c.req.url)}/s/${token}`;
  return apiJson(
    c,
    {
      data: {
        grantId: link.grantId,
        url,
        expiresAt: link.expiresAt,
        hasPassword: link.hasPassword,
        label: link.label,
        review: link.review,
      },
    },
    201,
  );
});
