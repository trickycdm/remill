import { createFactory } from 'hono/factory';
import type { Env } from '@/types';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/db/client';
import { requirePrincipal } from '@/lib/principal';
import { pathParam } from '@/lib/http';
import { grantItem, revokeItem } from '@/services/access';
import type { Action } from '@/access';
import { nowIso } from '@/lib/now';

const factory = createFactory<{ Bindings: Env }>();

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** POST /admin/c/:collection/:id/share — grant or revoke item-level access. */
export const onRequestPost = factory.createHandlers(requireAuth(), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const db = getDb(c.env.DB);
  const principal = requirePrincipal(c);
  const now = nowIso();
  const collection = pathParam(c, 'collection');
  const id = pathParam(c, 'id');
  const back = `/admin/c/${collection}/${id}`;

  if (String(body.op) === 'revoke') {
    await revokeItem(db, principal, String(body.grantId ?? ''), collection, id, now);
    return c.redirect(back, 303);
  }

  // subject is encoded "principal:<id>" | "role:<slug>" so one <select> covers both.
  const [kind, ...rest] = String(body.subject ?? '').split(':');
  const subjectId = rest.join(':');
  const rawExpiry = String(body.expiresAt ?? '').trim();
  // datetime-local (local time, no zone) → normalized ISO-8601 for lexicographic compare.
  const expiresAt = rawExpiry ? new Date(rawExpiry).toISOString() : undefined;

  await grantItem(
    db,
    principal,
    {
      subjectKind: kind === 'role' ? 'role' : 'principal',
      subjectId,
      documentId: id,
      collection,
      actions: asArray(body.action as string | string[] | undefined) as Action[],
      expiresAt,
    },
    now,
  );
  return c.redirect(back, 303);
});
