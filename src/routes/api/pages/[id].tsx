import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { publishPage } from '@/services/pages';
import { pageInputFrom } from '@/lib/pages-http';
import { getSettings } from '@/services/settings';
import { resolveBaseUrl } from '@/lib/base-url';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/**
 * PUT /api/pages/:id — replace a page's html (D62); its URL and share links
 * keep working and the old content stays in its history. Same two body forms
 * as POST. `If-Match: "<revision>"` (or `expectedRevision` in the JSON form)
 * makes the save conditional (D54): a stale revision is a 409 STALE_REVISION.
 * Omitted title/description/tags keep their stored values. Requires `update`.
 */
export const onRequestPut = factory.createHandlers(async (c) => {
  const now = nowIso();
  const db = getDb(c.env.DB);
  const principal = await apiPrincipal(c, now);
  const input = await pageInputFrom(c);
  const baseUrl = resolveBaseUrl(c.env, await getSettings(db), c.req.url);
  const page = await publishPage(
    db,
    principal,
    {
      ...input,
      id: pathParam(c, 'id'),
      expectedRevision: c.req.header('If-Match') ?? input.expectedRevision,
    },
    { secret: c.env.SESSION_SECRET, baseUrl },
    now,
  );
  c.header('ETag', `"${page.revision}"`);
  return apiJson(c, { data: page });
});
