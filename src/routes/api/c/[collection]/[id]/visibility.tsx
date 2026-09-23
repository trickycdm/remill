import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { setVisibility } from '@/services/documents';
import type { Visibility } from '@/db/queries/documents';
import { InputValidationError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/c/:collection/:id/visibility — set public/unlisted/private (D50):
 *  `{ "visibility": "public" | "unlisted" | "private" }`. */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = await jsonBody(c);
  if (typeof body.visibility !== 'string') {
    throw new InputValidationError([
      { path: 'visibility', message: 'Provide "public", "unlisted" or "private".' },
    ]);
  }
  const doc = await setVisibility(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    body.visibility as Visibility,
    now,
  );
  return apiJson(c, { data: doc });
});
