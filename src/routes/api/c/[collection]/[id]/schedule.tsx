import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { pathParam } from '@/lib/http';
import { apiPrincipal, jsonBody, apiJson } from '@/lib/api';
import { getDb } from '@/db/client';
import { scheduleDocument } from '@/services/documents';
import { InputValidationError } from '@/lib/errors';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

/** POST /api/c/:collection/:id/schedule — set or cancel a scheduled publish
 *  (D32): `{ "publishAt": "<ISO datetime>" }` schedules, `{ "publishAt": null }`
 *  cancels. Requires the `publish` action; drafts only. */
export const onRequestPost = factory.createHandlers(async (c) => {
  const now = nowIso();
  const body = await jsonBody(c);
  const raw = body.publishAt;
  if (raw !== null && typeof raw !== 'string') {
    throw new InputValidationError([
      { path: 'publishAt', message: 'Provide an ISO-8601 datetime, or null to cancel.' },
    ]);
  }
  const doc = await scheduleDocument(
    getDb(c.env.DB),
    await apiPrincipal(c, now),
    pathParam(c, 'collection'),
    pathParam(c, 'id'),
    raw,
    now,
  );
  return apiJson(c, { data: doc });
});
