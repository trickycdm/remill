/**
 * Shared plumbing for the passkey JSON endpoints (D58). These are called by the
 * passkey island with `fetch`, not by a Datastar form post, so they need two
 * things the form routes get for free:
 *
 *   • an explicit CSRF check (SECURITY_STANDARDS §8) — the `Origin` header must
 *     be this site's own origin;
 *   • JSON errors — a plain `{ error }` body the island can show, instead of the
 *     global handler's redirects.
 */

import type { Context } from 'hono';
import type { Env } from '@/types';
import { getDb, type Database } from '@/db/client';
import { jsonBody } from '@/lib/api';
import { AppError, ForbiddenError } from '@/lib/errors';
import { nowIso } from '@/lib/now';
import { resolveRelyingParty, type RelyingParty } from '@/lib/relying-party';

/** DOM id of the inline-error region inside one passkey's rename/remove dialog. */
export function passkeyResultId(passkeyId: string, action: 'rename' | 'remove'): string {
  return `passkey-${action}-result-${passkeyId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export interface PasskeyRequest {
  readonly db: Database;
  readonly rp: RelyingParty;
  readonly now: string;
  readonly body: Record<string, unknown>;
}

export async function passkeyJson(
  c: Context<{ Bindings: Env }>,
  run: (req: PasskeyRequest) => Promise<unknown>,
): Promise<Response> {
  try {
    const rp = resolveRelyingParty(c.env, c.req.url);
    if (c.req.header('Origin') !== rp.origin) throw new ForbiddenError('Cross-origin request refused.');
    const body = await jsonBody(c);
    return c.json(await run({ db: getDb(c.env.DB), rp, now: nowIso(), body }));
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return c.json({ error: err.details?.[0]?.message ?? err.friendlyMessage }, err.status as 400);
  }
}
